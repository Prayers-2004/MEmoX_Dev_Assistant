import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getNonce } from './utils';
import fetch from 'node-fetch';
import { RAGManager } from './rag/ragManager';
import { pipeline } from '@xenova/transformers';

const execAsync = promisify(exec);

interface CodeContext {
    file: string;
    code: string;
    language: string;
}

interface CodeElement {
    type: 'function' | 'class';
    name: string;
    signature?: string;
    startLine: number;
    endLine: number;
    code: string;
    comments?: string[];
    parameters?: string[];
    returnType?: string;
}

interface RepoIndex {
    [filePath: string]: {
        language: string;
        elements: CodeElement[];
        imports?: string[];
        fileContent: string;
    };
}

let ollamaStatus = {
    isInstalled: false,
    isDownloaded: false,
    modelName: '',
    performance: 'low' as 'high' | 'low',
    mode: 'local' as 'local' | 'cloud',
};

let repoIndex: RepoIndex = {};

let ragManager: RAGManager;

// Use the provided API key and endpoint for cloud fallback
const OPENAI_API_KEY = 'sk-sBl5ipZbLl6B4vYdV09MGNEqbZ33QPjBSVfucxwqkpnlH7Jt';
const OPENAI_API_URL = 'https://api.chatanywhere.tech/v1/chat/completions';

let localLLM: any = null;
let localLLMLoading: Promise<any> | null = null;

export function activate(context: vscode.ExtensionContext) {
    let chatPanel: vscode.WebviewPanel | undefined;

    // Initialize RAG system and index workspace
    ragManager = new RAGManager(context);
    ragManager.initialize().then(async () => {
        // Initialize both indexing systems
        await Promise.all([
            ragManager.indexWorkspace(),
            scanWorkspace() // Keep this for now to maintain repoIndex
        ]);
        console.log('Memox RAG system initialized and workspace indexing started.');
    }).catch(error => {
        console.error('Failed to initialize RAG system or index workspace:', error);
    });

    checkOllamaStatus();
    // Remove or comment out the call to the old scanWorkspace()
    // scanWorkspace(); // Start scanning the workspace on activation

    let disposable = vscode.commands.registerCommand('memox.openChat', () => {
        if (chatPanel) {
            chatPanel.reveal();
            return;
        }

        chatPanel = vscode.window.createWebviewPanel(
            'memoxChat',
            'Memox Chat',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'dist')
                ]
            }
        );

        chatPanel.webview.html = getWebviewContent(chatPanel.webview, context.extensionUri);

        chatPanel.onDidDispose(() => {
            chatPanel = undefined;
        });

        chatPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'sendMessage':
                    try {
                        // Get relevant context from RAG system
                        const context = await ragManager.getRelevantContext(message.message);
                        const response = await handleUserMessage({
                            ...message.message,
                            context
                        });
                        chatPanel?.webview.postMessage({
                            command: 'addMessage',
                            message: {
                                type: 'assistant',
                                content: response.content,
                                timestamp: Date.now()
                            }
                        });
                    } catch (error) {
                        chatPanel?.webview.postMessage({
                            command: 'error',
                            error: error instanceof Error ? error.message : 'An error occurred'
                        });
                    }
                    break;
                case 'sendCloudMessage':
                    try {
                        const response = await handleCloudMessage(message.message);
                        chatPanel?.webview.postMessage({
                            command: 'cloudResponse',
                            message: {
                                type: 'assistant',
                                content: response.content,
                                timestamp: Date.now()
                            }
                        });
                    } catch (error) {
                        chatPanel?.webview.postMessage({
                            command: 'error',
                            error: error instanceof Error ? error.message : 'Cloud error'
                        });
                    }
                    break;
                case 'checkOllamaStatus':
                    await checkOllamaStatus();
                    chatPanel?.webview.postMessage({
                        command: 'ollamaStatus',
                        status: ollamaStatus
                    });
                    break;
            }
        });
    });

    context.subscriptions.push(disposable);
}

// Keep the old scanWorkspace function for now, but ensure it's not called on activation
// We can potentially remove it later if it's no longer needed.
async function scanWorkspace() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    repoIndex = {}; // Clear previous index

    for (const folder of workspaceFolders) {
        const files = await vscode.workspace.findFiles(
            '**/*',
            '**/node_modules/**,**/.git/**,**/dist/**' // Exclude common directories
        );

        for (const file of files) {
            const relativePath = path.relative(folder.uri.fsPath, file.fsPath);
            const fileExtension = path.extname(file.fsPath).toLowerCase();
            const language = fileExtension.slice(1);

            // Original file filtering, which we want to avoid in the new RAG system
            // if (!['js', 'ts', 'py', 'java', 'c', 'cpp'].includes(language)) {
            //     continue;
            // }

            try {
                const content = await vscode.workspace.fs.readFile(file);
                const fileContent = Buffer.from(content).toString('utf-8');
                const lines = fileContent.split('\n');
                const elements: CodeElement[] = [];
                let currentElement: CodeElement | null = null;
                let currentComments: string[] = [];
                let imports: string[] = [];

                // Extract imports/dependencies
                lines.forEach(line => {
                    const importMatch = line.match(/^(?:import|from|require|using)\s+(.+)/);
                    if (importMatch) {
                        imports.push(importMatch[1].trim());
                    }
                });

                // Process each line for code elements
                lines.forEach((line, index) => {
                    const lineNumber = index + 1;
                    let match;

                    // Collect comments
                    const commentMatch = line.match(/^\s*(?:\/\/|\#|\/\*|\*)\s*(.+)/);
                    if (commentMatch) {
                        currentComments.push(commentMatch[1].trim());
                        return;
                    }

                    // Python functions
                    match = line.match(/^\s*def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(\w+))?/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        currentElement = {
                            type: 'function',
                            name: match[1],
                            signature: match[0],
                            startLine: lineNumber,
                            endLine: lineNumber,
                            code: '',
                            parameters: match[2].split(',').map(p => p.trim()),
                            returnType: match[3],
                            comments: []
                        };
                        currentComments = [];
                        return;
                    }

                    // Python classes
                    match = line.match(/^\s*class\s+(\w+)\s*(?:\((.*?)\))?:/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        currentElement = {
                            type: 'class',
                            name: match[1],
                            signature: match[0],
                            startLine: lineNumber,
                            endLine: lineNumber,
                            code: '',
                            comments: []
                        };
                        currentComments = [];
                        return;
                    }

                    // JS/TS functions
                    match = line.match(/^\s*(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*(\w+))?\s*=>)/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        const name = match[1] || match[2];
                        if (name) {
                            currentElement = {
                                type: 'function',
                                name: name,
                                signature: match[0],
                                startLine: lineNumber,
                                endLine: lineNumber,
                                code: '',
                                parameters: match[3].split(',').map(p => p.trim()),
                                returnType: match[4],
                                comments: []
                            };
                            currentComments = [];
                        }
                        return;
                    }

                    // JS/TS classes
                    match = line.match(/^\s*class\s+(\w+)(?:\s+extends\s+(\w+))?/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        currentElement = {
                            type: 'class',
                            name: match[1],
                            signature: match[0],
                            startLine: lineNumber,
                            endLine: lineNumber,
                            code: '',
                            comments: []
                        };
                        currentComments = [];
                        return;
                    }
                });

                // Add the last element if exists
                if (currentElement) {
                    const element = currentElement as CodeElement;
                    element.endLine = lines.length;
                    element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                    element.comments = currentComments;
                    elements.push(element);
                }

                repoIndex[relativePath] = {
                    language,
                    elements,
                    imports,
                    fileContent
                };
            } catch (e) {
                console.error(`Memox: Error reading file ${relativePath}: ${e}`);
            }
        }
    }

    console.log('Memox: Workspace scanned. Index built with elements.', Object.keys(repoIndex).length, 'files indexed.');
    // TODO: Potentially inform the webview that scanning is complete and show a summary
}

async function checkOllamaStatus() {
    try {
        await execAsync('ollama --version');
        ollamaStatus.isInstalled = true;
        const { stdout } = await execAsync('ollama list');
        const hasCodeLLaMA = stdout.includes('codellama');
        ollamaStatus.isDownloaded = hasCodeLLaMA;
        ollamaStatus.modelName = hasCodeLLaMA ? 'CodeLLaMA' : '';
        const totalMemory = require('os').totalmem();
        ollamaStatus.performance = totalMemory > 16 * 1024 * 1024 * 1024 ? 'high' : 'low';
        ollamaStatus.mode = hasCodeLLaMA ? 'local' : 'cloud';
    } catch (error) {
        ollamaStatus.isInstalled = false;
        ollamaStatus.isDownloaded = false;
        ollamaStatus.mode = 'cloud';
    }
}

function tokenize(str: string) {
    return str.split(/\W+/).filter(Boolean);
}

function tokenOverlap(a: string, b: string) {
    const aTokens = new Set(tokenize(a));
    const bTokens = new Set(tokenize(b));
    let overlap = 0;
    for (const t of aTokens) if (bTokens.has(t)) overlap++;
    return overlap / Math.max(aTokens.size, 1);
}

async function handleUserMessage(message: { content: string; timestamp: number; context?: string }) {
    // Get relevant context from RAG
    const context = await ragManager.getRelevantContext(message.content);

    // Build the prompt
    const prompt = context
        ? `You are an expert code assistant. Use the following code context from the repository to answer the user's question. If the answer is not in the context, say so.\n\nCODE CONTEXT:\n${context}\n\nUSER QUESTION:\n${message.content}\n\nAnswer as helpfully as possible, using the code context above.`
        : message.content;

    // Use a local LLM pipeline for answering
    try {
        if (!localLLM) {
            if (!localLLMLoading) {
                // Prefer a text2text model for better instruction following
                localLLMLoading = pipeline('text2text-generation', 'Xenova/flan-t5-small', { quantized: true });
            }
            localLLM = await localLLMLoading;
        }
        const output = await localLLM(prompt, { max_new_tokens: 256 });
        const answer = Array.isArray(output) && output[0]?.generated_text ? output[0].generated_text : (output?.generated_text || '');
        return { content: answer.trim(), codeContext: undefined };
    } catch (err) {
        console.error('Local LLM error:', err);
        return { content: 'Sorry, the local AI model failed to answer your question. Please try again or use the cloud mode.', codeContext: undefined };
    }
}

async function handleCloudMessage(message: { content: string; timestamp: number }) {
    const apiKey = OPENAI_API_KEY;
    
    // Get repository overview
    let repoContext = '';
    if (Object.keys(repoIndex).length > 0) {
        repoContext = 'Repository Structure:\n';
        for (const filePath in repoIndex) {
            repoContext += `\nFile: ${filePath}\n`;
            repoContext += `Language: ${repoIndex[filePath].language}\n`;
            if (repoIndex[filePath].elements.length > 0) {
                repoContext += 'Elements:\n';
                repoIndex[filePath].elements.forEach(el => {
                    repoContext += `- ${el.type}: ${el.name}\n`;
                    if (el.comments && el.comments.length > 0) {
                        repoContext += `  Comments: ${el.comments.join(', ')}\n`;
                    }
                });
            }
            repoContext += '\n';
        }
    } else {
        repoContext = 'No repository files have been indexed yet.';
    }

    // Get relevant context from RAG system
    const ragContext = await ragManager.getRelevantContext(message.content);
    
    // Build the prompt with both repository overview and RAG context
    const prompt = `You are an expert code assistant. Use the following repository context to answer the user's question.

${repoContext}

RELEVANT CODE CONTEXT:
${ragContext || 'No specific code context found.'}

USER QUESTION:
${message.content}

Please provide a detailed answer based on the repository structure and code context above. If the answer is not in the context, say so. Format your response in a clear and organized way.`;

    const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1024
        })
    });

    const data = await response.json();
    const assistantResponse = data.choices?.[0]?.message?.content || 'No response from cloud.';
    return { content: assistantResponse };
}

async function findSimilarCode(code: string): Promise<CodeContext | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return undefined;
    const searchResults = await vscode.workspace.findFiles(
        '**/*.{js,ts,py,java,c,cpp}',
        '**/node_modules/**'
    );
    let best: { score: number; ctx: CodeContext } | undefined;
    for (const file of searchResults) {
        const content = await vscode.workspace.fs.readFile(file);
        const fileContent = Buffer.from(content).toString('utf-8');
        const score = tokenOverlap(code, fileContent);
        if (!best || score > best.score) {
            best = {
                score,
                ctx: {
                    file: path.relative(workspaceFolders[0].uri.fsPath, file.fsPath),
                    code: fileContent,
                    language: path.extname(file.fsPath).slice(1)
                }
            };
        }
    }
    if (best && best.score > 0.2) return best.ctx;
    return undefined;
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview-ui', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview-ui', 'index.css')
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${styleUri}" rel="stylesheet">
        <title>Memox Chat</title>
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}

export function deactivate() {}
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getNonce } from './utils';
import fetch from 'node-fetch';

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

// Use the provided API key and endpoint for cloud fallback
const OPENAI_API_KEY = 'sk-sBl5ipZbLl6B4vYdV09MGNEqbZ33QPjBSVfucxwqkpnlH7Jt';
const OPENAI_API_URL = 'https://api.chatanywhere.tech/v1/chat/completions';

export function activate(context: vscode.ExtensionContext) {
    let chatPanel: vscode.WebviewPanel | undefined;

    checkOllamaStatus();
    scanWorkspace(); // Start scanning the workspace on activation

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
                        const response = await handleUserMessage(message.message);
                        chatPanel?.webview.postMessage({
                            command: 'addMessage',
                            message: {
                                type: 'assistant',
                                content: response.content,
                                timestamp: Date.now(),
                                codeContext: response.codeContext
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
                                timestamp: Date.now(),
                                codeContext: response.codeContext
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

            // Only process supported code files for now
            if (!['js', 'ts', 'py', 'java', 'c', 'cpp'].includes(language)) {
                continue;
            }

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

async function handleUserMessage(message: { content: string; timestamp: number }) {
    const isCodeImprovement = /improve|refactor|optimize/i.test(message.content);
    const isExplainRepo = /explain this repository|what is this project|repository overview/i.test(message.content);
    const isCodeQuestion = /how|what|why|where|when|explain|describe|tell me about/i.test(message.content);

    let codeContext: CodeContext | undefined;
    let assistantResponse = '';
    let relevantContext = '';

    // Extract potential function/class names from the question
    const functionMatches = message.content.match(/\b(function|method|class)\s+(\w+)\b/i);
    const nameMatches = message.content.match(/\b(\w+)\s+(function|method|class)\b/i);
    const directNameMatches = message.content.match(/\b(\w+)\b/g);

    let targetName = '';
    if (functionMatches) {
        targetName = functionMatches[2];
    } else if (nameMatches) {
        targetName = nameMatches[1];
    } else if (directNameMatches) {
        // Try to find the most relevant function/class name from the question
        for (const name of directNameMatches) {
            for (const filePath in repoIndex) {
                const element = repoIndex[filePath].elements.find(el => el.name.toLowerCase() === name.toLowerCase());
                if (element) {
                    targetName = name;
                    break;
                }
            }
            if (targetName) break;
        }
    }

    // If we found a target name, get its context
    if (targetName) {
        for (const filePath in repoIndex) {
            const element = repoIndex[filePath].elements.find(el => el.name.toLowerCase() === targetName.toLowerCase());
            if (element) {
                codeContext = {
                    file: filePath,
                    code: element.code,
                    language: repoIndex[filePath].language
                };
                relevantContext += `Found ${element.type} "${element.name}" in ${filePath}:\n`;
                if (element.comments && element.comments.length > 0) {
                    relevantContext += `Comments:\n${element.comments.join('\n')}\n`;
                }
                if (element.parameters) {
                    relevantContext += `Parameters: ${element.parameters.join(', ')}\n`;
                }
                if (element.returnType) {
                    relevantContext += `Return type: ${element.returnType}\n`;
                }
                relevantContext += `\nCode:\n${element.code}\n\n`;
                break;
            }
        }
    }

    // Add general repository context
    if (Object.keys(repoIndex).length > 0) {
        relevantContext += 'Repository Overview:\n';
        for (const filePath in repoIndex) {
            relevantContext += `- ${filePath} (${repoIndex[filePath].language})\n`;
            if (repoIndex[filePath].imports && repoIndex[filePath].imports.length > 0) {
                relevantContext += `  Imports: ${repoIndex[filePath].imports.join(', ')}\n`;
            }
            if (repoIndex[filePath].elements.length > 0) {
                relevantContext += '  Elements:\n';
                repoIndex[filePath].elements.forEach(el => {
                    relevantContext += `    - ${el.type}: ${el.name}\n`;
                });
            }
        }
        relevantContext += '\n';
    }

    // Construct the prompt
    let prompt = message.content;
    if (relevantContext || codeContext) {
        prompt = `Context from the codebase:\n\n${relevantContext}${codeContext ? `File: ${codeContext.file}\nLanguage: ${codeContext.language}\n\n${codeContext.code}\n\n` : ''}Please answer the following question. Format any code snippets using markdown code blocks (\`\`\`language\ncode\n\`\`\`).\n${message.content}`;
    } else {
        prompt = `Please answer the following question. Format any code snippets using markdown code blocks (\`\`\`language\ncode\n\`\`\`).\n${message.content}`;
    }

    try {
        const { stdout } = await execAsync(`ollama run codellama "${prompt}"`);
        assistantResponse = stdout.trim();
    } catch (error) {
        throw new Error('Failed to get response from Ollama. Please make sure Ollama is running and the model is downloaded.');
    }

    return { content: assistantResponse, codeContext };
}

async function handleCloudMessage(message: { content: string; timestamp: number }) {
    const apiKey = OPENAI_API_KEY;
    let codeContext: CodeContext | undefined;
    const isCodeImprovement = /improve|refactor|optimize/i.test(message.content);
    const isExplainRepo = /explain this repository|what is this project|repository overview/i.test(message.content);

    let assistantResponse = '';
    let relevantContext = ''; // Gather relevant info for the prompt

    if (isExplainRepo) {
         if (Object.keys(repoIndex).length > 0) {
            assistantResponse = 'This repository contains the following code files and key elements:\n\n';
            for (const filePath in repoIndex) {
                assistantResponse += `- ${filePath} (${repoIndex[filePath].language})\n`;
                 if (repoIndex[filePath].elements.length > 0) {
                     assistantResponse += '  Elements:\n';
                     repoIndex[filePath].elements.forEach(el => {
                         assistantResponse += `    - ${el.type}: ${el.name}\n`;
                     });
                 }
            }
            assistantResponse += '\nHow else can I help you with this repository?';
        } else {
            assistantResponse = 'I haven\'t finished scanning the repository yet, or the workspace is empty.';
        }
        return { content: assistantResponse };
    }

    // Add relevant repo context to prompt for other questions
     if (Object.keys(repoIndex).length > 0) {
         relevantContext += 'Codebase Index Overview:\n';
         for (const filePath in repoIndex) {
              relevantContext += `- ${filePath} (${repoIndex[filePath].language})\n`;
              if (repoIndex[filePath].elements.length > 0) {
                  relevantContext += '  Elements:\n';
                  repoIndex[filePath].elements.forEach(el => {
                      relevantContext += `    - ${el.type}: ${el.name}\n`;
                  });
              }
          }
          relevantContext += '\n';
       }

    if (isCodeImprovement) {
        const codeMatch = message.content.match(/```(\w+)?\n([\s\S]*?)```/);
        if (codeMatch) {
            const language = codeMatch[1] || 'plaintext';
            const code = codeMatch[2].trim();
            const similarCode = await findSimilarCode(code);
            if (similarCode) codeContext = similarCode;
        }
    }

    let prompt = message.content;
    if (relevantContext || codeContext) {
         prompt = `Context from the codebase:\n\n${relevantContext}${codeContext ? `File: ${codeContext.file}\nLanguage: ${codeContext.language}\n\n${codeContext.code}\n\n` : ''}Please answer the following question. Format any code snippets using markdown code blocks (\`\`\`language\ncode\n\`\`\`).\n${message.content}`;
     } else {
         prompt = `Please answer the following question. Format any code snippets using markdown code blocks (\`\`\`language\ncode\n\`\`\`).\n${message.content}`;
     }

    const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 512
        })
    });
    const data = await response.json();
    assistantResponse = data.choices?.[0]?.message?.content || 'No response from cloud.';
    return { content: assistantResponse, codeContext };
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
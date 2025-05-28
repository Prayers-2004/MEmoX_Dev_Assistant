import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodeChunker } from './chunker';
import { VectorStore } from './vectorStore';
import { CodeChunk } from './chunker';

export class RAGManager {
    private chunker: CodeChunker;
    private vectorStore: VectorStore;
    private indexPath: string;

    constructor(context: vscode.ExtensionContext) {
        this.chunker = new CodeChunker();
        this.indexPath = path.join(context.globalStorageUri.fsPath, 'code_index.json');
        this.vectorStore = new VectorStore(this.indexPath);
    }

    async initialize() {
        // Create storage directory if it doesn't exist
        const dir = path.dirname(this.indexPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // No need to call load, it's done in constructor
    }

    async indexWorkspace() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showInformationMessage('No workspace folder open to index.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Indexing workspace for Memox',
            cancellable: false
        }, async (progress, token) => {
            let totalFiles = 0;
            let processedFiles = 0;

            const excludePattern = '{**/node_modules/**,**/.git/**,**/.vscode/**,**/dist/**,**/out/**,**/.next/**,**/.cache/**,**/.DS_Store,**/*.lock,**/*.log,**/.env*,**/.idea/**,**/.vs/**,**/.history/**,**/*.png,**/*.jpg,**/*.jpeg,**/*.gif,**/*.bmp,**/*.svg,**/*.pdf,**/*.doc,**/*.docx,**/*.xls,**/*.xlsx,**/*.ppt,**/*.pptx,**/*.zip,**/*.tar,**/*.gz,**/*.7z,**/*.rar,**/*.exe,**/*.dll,**/*.so,**/*.dylib,**/*.mp3,**/*.mp4,**/*.avi,**/*.mov,**/*.wasm,**/*.node,**/*.afdesign,**/package.json,**/package-lock.json}';

            // First, count total files (excluding binary, ignored, and package.json)
            for (const folder of workspaceFolders) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*'),
                    excludePattern
                );
                totalFiles += files.length;
            }

            progress.report({ message: `Found ${totalFiles} text files. Starting indexing...` });

            for (const folder of workspaceFolders) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*'),
                    excludePattern
                );

                for (const file of files) {
                    if (token.isCancellationRequested) {
                        vscode.window.showInformationMessage('Workspace indexing cancelled.');
                        return;
                    }

                    const stat = await vscode.workspace.fs.stat(file);
                    if (stat.size > 1024 * 1024) {
                        processedFiles++;
                        const percentage = Math.round((processedFiles / totalFiles) * 100);
                        progress.report({
                            increment: (1 / totalFiles) * 100,
                            message: `Skipping large file: ${percentage}% - ${path.basename(file.fsPath)}`
                        });
                        continue; // skip files >1MB
                    }

                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Indexing file: ${path.basename(file.fsPath)}`,
                            cancellable: false
                        }, async (fileProgress) => {
                            const document = await vscode.workspace.openTextDocument(file.fsPath);
                            const lines = document.getText().split('\n');
                            const totalLines = lines.length;
                            let processedLines = 0;

                            // We'll chunk the file in batches of lines for progress reporting
                            const chunkSize = 50;
                            for (let i = 0; i < totalLines; i += chunkSize) {
                                // Simulate chunking by lines (actual chunking is handled in chunkFile)
                                processedLines = Math.min(i + chunkSize, totalLines);
                                fileProgress.report({
                                    increment: (chunkSize / totalLines) * 100,
                                    message: `Indexed ${processedLines}/${totalLines} lines`
                                });
                                // Small delay to allow UI update (remove in production for speed)
                                await new Promise(res => setTimeout(res, 1));
                            }
                            // Now actually chunk and add to vector store
                            const chunks = await this.chunker.chunkFile(file.fsPath);
                            await this.vectorStore.addChunks(chunks);
                        });
                        processedFiles++;
                        const percentage = Math.round((processedFiles / totalFiles) * 100);
                        progress.report({
                            increment: (1 / totalFiles) * 100,
                            message: `Indexing: ${percentage}% - ${path.basename(file.fsPath)}`
                        });
                    } catch (error: any) {
                        console.warn(`Skipping file due to error: ${file.fsPath}`, error);
                        processedFiles++;
                        const percentage = Math.round((processedFiles / totalFiles) * 100);
                        progress.report({
                            increment: (1 / totalFiles) * 100,
                            message: `Error/Skipped: ${percentage}% - ${path.basename(file.fsPath)}`
                        });
                    }
                }
            }

            progress.report({ increment: 100, message: 'Indexing complete!' });
            vscode.window.showInformationMessage('Memox workspace indexing complete.');
        });
    }

    async search(query: string, k: number = 5): Promise<CodeChunk[]> {
        return this.vectorStore.search(query, k);
    }

    async getRelevantContext(query: string, maxTokens: number = 1024): Promise<string> {
        const chunks = await this.search(query);
        let context = '';
        let currentTokens = 0;

        for (const chunk of chunks) {
            const chunkTokens = chunk.content.split(/\s+/).length; // Rough token estimation
            if (currentTokens + chunkTokens > maxTokens) {
                break;
            }
            context += `\n--- ${chunk.metadata.filename} (${chunk.metadata.startLine}-${chunk.metadata.endLine}) ---\n${chunk.content}\n`;
            currentTokens += chunkTokens;
        }

        return context;
    }
} 
import * as vscode from 'vscode';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import * as path from 'path';

export interface CodeChunk {
    content: string;
    metadata: {
        filename: string;
        language: string;
        startLine: number;
        endLine: number;
        type: 'function' | 'class' | 'block' | 'markdown' | 'text' | 'config' | 'line-block' | 'whole-file';
    };
}

export class CodeChunker {
    private readonly maxTokens = 512;
    private readonly overlap = 50;
    private readonly codeLanguages = ['typescript', 'javascript', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin'];
    private readonly configLanguages = ['json', 'yaml', 'yml', 'ini', 'xml'];
    private readonly markdownLanguages = ['markdown'];

    constructor() {}

    async chunkFile(filePath: string): Promise<CodeChunk[]> {
        const document = await vscode.workspace.openTextDocument(filePath);
        const content = document.getText();
        const language = document.languageId;
        const lines = content.split('\n');
        const filename = path.basename(filePath);
        const recognizedLanguages = await vscode.languages.getLanguages();

        let chunks: CodeChunk[] = [];

        if (filename.toLowerCase() === 'readme.md') {
            // Handle README.md as a single chunk, always
             chunks = [{
                 content,
                 metadata: {
                     filename,
                     language,
                     startLine: 0,
                     endLine: lines.length - 1,
                     type: 'whole-file'
                 }
             }];
        } else if (this.codeLanguages.includes(language)) {
            // Semantic splitting for code files, then token-based if needed
            const semanticChunks = this.splitBySemanticUnits(content, language, filename);
             chunks = semanticChunks;
        } else if (this.markdownLanguages.includes(language) || this.configLanguages.includes(language) || !recognizedLanguages.includes(language)) {
             // For other markdown, config, and unrecognized languages, split by lines initially
             for (let i = 0; i < lines.length; i++) {
                 chunks.push({
                     content: lines[i],
                     metadata: { 
                         filename, 
                         language, 
                         startLine: i, 
                         endLine: i, 
                         type: this.markdownLanguages.includes(language) ? 'markdown' : (this.configLanguages.includes(language) ? 'config' : 'text')
                     }
                 });
             }

        } else {
            // For other recognized but non-code text files, treat as a single block initially
            chunks = [{ 
                content, 
                metadata: { 
                    filename, 
                    language, 
                    startLine: 0, 
                    endLine: lines.length - 1, 
                    type: 'text' 
                } 
            }];
        }

        // Apply token-based splitting only to chunks that are not whole files
        const finalChunks = chunks.flatMap(chunk => {
             if (chunk.metadata.type === 'whole-file') {
                 // If it's the whole README.md, keep as a single chunk
                 return [chunk];
             } else {
                  // For other chunk types, apply token-based splitting
                 return this.splitByTokenSize(chunk.content, chunk.metadata);
             }
        });

        // Filter out any empty chunks that might have been created during splitting
        return finalChunks.filter(chunk => chunk.content.trim().length > 0);
    }

    private splitBySemanticUnits(content: string, language: string, filename: string): CodeChunk[] {
        const chunks: CodeChunk[] = [];
        const lines = content.split('\n');
        let currentChunk: string[] = [];
        let startLine = 0;
        let inFunction = false;
        let inClass = false;
        let braceCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            currentChunk.push(line);

            // Detect function/class boundaries based on language (simplified for common patterns)
            if (language === 'typescript' || language === 'javascript' || language === 'python' || language === 'java' || language === 'c' || language === 'cpp' || language === 'csharp' || language === 'go' || language === 'rust' || language === 'php' || language === 'ruby' || language === 'swift' || language === 'kotlin') {
                // Basic code structure detection (can be enhanced)
                if (line.includes('function') || line.includes('def ') || line.includes(' class ')) {
                     // Simple heuristic: reset semantic chunk on detecting a new potential code element start
                     if (currentChunk.length > 1) { // Check if current chunk is not just the starting line itself
                         chunks.push({
                             content: currentChunk.slice(0, currentChunk.length - 1).join('\n'), // Add previous lines
                             metadata: {
                                 filename,
                                 language,
                                 startLine,
                                 endLine: i - 1,
                                 type: 'block' // Treat as a block before the new element
                             }
                         });
                         currentChunk = [line]; // Start new chunk with the current line
                         startLine = i;
                         braceCount = 0; // Reset brace count for the new potential element
                         inFunction = false;
                         inClass = false;
                     }
                     
                     // Simple check for function/class declaration line
                     if (line.match(/^\s*(?:function|class|def|interface|enum)\s+/)) {
                        if(line.includes('function') || line.includes('=>')) inFunction = true;
                        if(line.includes('class')) inClass = true;
                        braceCount += (line.match(/{/g) || []).length;
                        braceCount -= (line.match(/}/g) || []).length;

                         // If the declaration line also closes the block (e.g., arrow function on one line), finalize the chunk
                         if (braceCount === 0 && (inFunction || inClass)) {
                               chunks.push({
                                   content: currentChunk.join('\n'),
                                   metadata: {
                                       filename,
                                       language,
                                       startLine,
                                       endLine: i,
                                       type: inFunction ? 'function' : 'class'
                                   }
                               });
                               currentChunk = [];
                               startLine = i + 1;
                               inFunction = false;
                               inClass = false;
                         }
                     } else {
                          // For lines within a function/class, track braces
                          braceCount += (line.match(/{/g) || []).length;
                          braceCount -= (line.match(/}/g) || []).length;

                          // If brace count returns to zero, assume semantic block ends
                          if (braceCount === 0 && (inFunction || inClass)) {
                                chunks.push({
                                    content: currentChunk.join('\n'),
                                    metadata: {
                                        filename,
                                        language,
                                        startLine,
                                        endLine: i,
                                        type: inFunction ? 'function' : 'class'
                                    }
                                });
                                currentChunk = [];
                                startLine = i + 1;
                                inFunction = false;
                                inClass = false;
                           }
                     }
                }
            }
        }

        // Add any remaining content as a block
        if (currentChunk.length > 0) {
            chunks.push({
                content: currentChunk.join('\n'),
                metadata: {
                    filename,
                    language,
                    startLine,
                    endLine: lines.length - 1,
                    type: 'block'
                }
            });
        }

        // Filter out empty chunks that might result from splitting
        return chunks.filter(chunk => chunk.content.trim().length > 0);
    }

    private splitByTokenSize(content: string, metadata: CodeChunk['metadata']): CodeChunk[] {
        const chunks: CodeChunk[] = [];
        const lines = content.split('\n');
        let currentChunkLines: string[] = [];
        let currentTokens = 0;
        let currentChunkStartLine = metadata.startLine;

        const encoder = encoding_for_model('gpt2' as TiktokenModel); // Using 'gpt2' as a commonly supported model

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Attempt to encode the line with error handling
            let lineTokens = 0;
            try {
                lineTokens = encoder.encode(line).length;
            } catch (error) {
                 console.error(`Error encoding line ${i + metadata.startLine} in ${metadata.filename}:`, error);
                 lineTokens = 1; // Assign a minimal token count on error
            }

            // If adding this line exceeds the max tokens AND we have content in the current chunk
            if (currentTokens + lineTokens > this.maxTokens && currentChunkLines.length > 0) {
                chunks.push({
                    content: currentChunkLines.join('\n'),
                    metadata: {
                        ...metadata,
                        startLine: currentChunkStartLine,
                        endLine: currentChunkStartLine + currentChunkLines.length - 1
                    }
                });

                // Keep some overlap
                const overlapLines = currentChunkLines.slice(-this.overlap);
                currentChunkLines = overlapLines;
                currentTokens = overlapLines.reduce((sum, l) => {
                     try {
                         return sum + encoder.encode(l).length;
                     } catch (error) {
                         console.error(`Error encoding overlap line: ${l}`, error);
                         return sum + 1; // Add minimal token count on error
                     }
                }, 0);
                currentChunkStartLine = metadata.startLine + i - overlapLines.length;
            } else if (currentTokens + lineTokens > this.maxTokens && currentChunkLines.length === 0) {
                 // Handle case where even a single line exceeds maxTokens
                 chunks.push({
                      content: line,
                      metadata: {
                          ...metadata,
                          startLine: metadata.startLine + i,
                          endLine: metadata.startLine + i,
                          type: 'line-block' // Indicate this is a single large line chunk
                      }
                 });
                 currentChunkStartLine = metadata.startLine + i + 1;
                 continue; // Move to the next line
            }

            // Add the current line to the current chunk and update token count
            currentChunkLines.push(line);
            currentTokens += lineTokens;
        }

        // Add any remaining content as the last chunk
        if (currentChunkLines.length > 0) {
            chunks.push({
                content: currentChunkLines.join('\n'),
                metadata: {
                    ...metadata,
                    startLine: currentChunkStartLine,
                    endLine: metadata.startLine + lines.length - 1
                }
            });
        }

        // Filter out any empty chunks that might have been created
        return chunks.filter(chunk => chunk.content.trim().length > 0);
    }
} 
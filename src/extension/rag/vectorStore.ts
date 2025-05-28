import * as fs from 'fs';
import { pipeline, env } from '@xenova/transformers';
import { CodeChunk } from './chunker';

// Force WASM backend
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = undefined;

export interface ChunkEmbedding {
    chunk: CodeChunk;
    embedding: number[];
}

export class VectorStore {
    private dbPath: string;
    private data: ChunkEmbedding[] = [];
    private embedder: any;
    private initialized = false;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
        this.load();
    }

    async initialize() {
        if (!this.initialized) {
            this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            this.initialized = true;
        }
    }

    async addChunks(chunks: CodeChunk[]) {
        await this.initialize();
        for (const chunk of chunks) {
            const embedding = await this.getEmbedding(chunk.content);
            this.data.push({ chunk, embedding });
        }
        this.save();
    }

    async search(query: string, k: number = 5): Promise<CodeChunk[]> {
        await this.initialize();
        const queryEmbedding = await this.getEmbedding(query);
        const scored = this.data.map(item => ({
            chunk: item.chunk,
            score: cosineSimilarity(queryEmbedding, item.embedding)
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k).map(s => s.chunk);
    }

    private async getEmbedding(text: string): Promise<number[]> {
        const output = await this.embedder(text, {
            pooling: 'mean',
            normalize: true
        });
        return Array.from(output.data);
    }

    private save() {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
        }
    }
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
} 
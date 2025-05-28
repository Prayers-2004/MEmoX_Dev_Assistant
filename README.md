# Memox - AI-Powered Code Assistant

Memox is an AI-powered code assistant for VS Code that helps you understand and work with your codebase more effectively. It now features a powerful RAG (Retrieval-Augmented Generation) system that enables it to handle large codebases efficiently.

## Features

- 🤖 AI-powered code understanding and assistance
- 🔍 Semantic code search using RAG
- 📚 Efficient handling of large codebases
- 💡 Intelligent code suggestions and improvements
- 🔄 Real-time code analysis
- 🌐 Local and cloud inference options

## New RAG System

The latest version of Memox includes a sophisticated RAG system that enables it to handle large codebases efficiently:

### Code Chunking
- Automatically splits code into semantic chunks (functions, classes, or fixed-size blocks)
- Preserves code context and structure
- Handles multiple programming languages

### Vector Search
- Uses HNSWlib for fast similarity search
- Employs MiniLM-L6-v2 for high-quality embeddings
- Efficiently retrieves relevant code context

### Smart Context Management
- Dynamically selects relevant code chunks based on user queries
- Maintains token limits while maximizing context relevance
- Preserves code structure and relationships

## Installation

1. Install the extension from the VS Code marketplace
2. The extension will automatically initialize and index your workspace
3. Open the Memox chat panel using the command palette (Ctrl+Shift+P) and typing "Open Memox Chat"

## Usage

1. Open the Memox chat panel
2. Type your question or request
3. Memox will automatically:
   - Search for relevant code context
   - Generate a response using the retrieved context
   - Present the answer with code references

## Requirements

- VS Code 1.86.0 or higher
- Node.js 14.0.0 or higher
- For local inference: Ollama installed (optional)

## Configuration

The RAG system can be configured through VS Code settings:

- `memox.rag.maxTokens`: Maximum tokens per chunk (default: 512)
- `memox.rag.overlap`: Chunk overlap size (default: 50)
- `memox.rag.searchResults`: Number of chunks to retrieve (default: 5)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 
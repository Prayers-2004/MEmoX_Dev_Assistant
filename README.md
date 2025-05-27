# Memox - AI-Powered Code Assistant for VS Code

Memox is a powerful VS Code extension that provides AI-powered code assistance, combining the best features of GitHub Copilot and Cursor. It offers both local and cloud-based AI capabilities for code understanding, improvement suggestions, and intelligent code completion.

## Features

- 🤖 AI Chat Panel with contextual code understanding
- 💻 Local AI mode using Ollama + CodeLLaMA
- ☁️ Cloud AI fallback with Sonar API
- 🔍 Smart code scanning and indexing
- 📝 Code improvement suggestions
- 🌐 Multi-language support
- 🖥️ Cross-platform compatibility

## Installation

1. Install the extension from the VS Code marketplace
2. For local AI mode:
   - Install [Ollama](https://ollama.ai/)
   - Run `ollama pull codellama:7b` (or `codellama:3b` for systems with less RAM)

## Usage

1. Open the Memox Chat panel using the command palette (Ctrl+Shift+P) and type "Open Memox Chat"
2. Type your questions or paste code for improvement suggestions
3. The AI will analyze your codebase and provide contextual responses

## Development

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Watch for changes
npm run watch
```

## Requirements

- VS Code 1.86.0 or higher
- Node.js 16.x or higher
- For local AI: Ollama with CodeLLaMA model

## License

MIT 
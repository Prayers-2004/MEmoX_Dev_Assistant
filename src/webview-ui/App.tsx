import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, AlertCircle, Copy, Trash2, Cloud } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism'; // Choose a syntax highlighting style

interface Message {
    type: 'user' | 'assistant' | 'error' | 'system';
    content: string;
    timestamp: number;
    codeContext?: {
        file: string;
        code: string;
        language: string;
    };
}

interface ModelStatus {
    isInstalled: boolean;
    isDownloaded: boolean;
    modelName: string;
    performance: 'high' | 'low';
    mode: 'local' | 'cloud';
}

declare global {
    interface Window {
        acquireVsCodeApi: () => {
            postMessage: (message: any) => void;
            getState: () => any;
            setState: (state: any) => void;
        };
    }
}

const vscode = window.acquireVsCodeApi();

const BANNER_STYLE =
    'w-full text-center py-2 px-4 text-sm font-medium rounded mb-2 flex items-center justify-center gap-2';

export function App() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [modelStatus, setModelStatus] = useState<ModelStatus>({
        isInstalled: false,
        isDownloaded: false,
        modelName: '',
        performance: 'low',
        mode: 'local',
    });
    const [showCloud, setShowCloud] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        vscode.postMessage({ command: 'checkOllamaStatus' });
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'addMessage':
                    setMessages(prev => [...prev, message.message]);
                    setIsLoading(false);
                    break;
                case 'ollamaStatus':
                    setModelStatus({ ...message.status, mode: message.status.isInstalled && message.status.isDownloaded ? 'local' : 'cloud' });
                    break;
                case 'cloudResponse':
                    setMessages(prev => [...prev, message.message]);
                    setIsLoading(false);
                    break;
                case 'error':
                    setMessages(prev => [...prev, {
                        type: 'error',
                        content: message.error,
                        timestamp: Date.now()
                    }]);
                    setIsLoading(false);
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        const userMessage: Message = {
            type: 'user',
            content: input.trim(),
            timestamp: Date.now()
        };
        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);
        vscode.postMessage({
            command: modelStatus.mode === 'local' ? 'sendMessage' : 'sendCloudMessage',
            message: {
                content: input.trim(),
                timestamp: Date.now()
            }
        });
        setInput('');
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleClear = () => {
        setMessages([]);
    };

    const renderMessage = (message: Message, index: number) => {
        const isUser = message.type === 'user';
        const isError = message.type === 'error';
        const isSystem = message.type === 'system';
        return (
            <div
                key={message.timestamp + '-' + index}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
            >
                <div
                    className={`max-w-[80%] rounded-xl p-4 shadow-md relative ${
                        isUser
                            ? 'bg-gradient-to-br from-blue-700 to-blue-900 text-white'
                            : isError
                            ? 'bg-gradient-to-br from-red-700 to-red-900 text-white'
                            : isSystem
                            ? 'bg-gradient-to-br from-gray-700 to-gray-900 text-gray-200'
                            : 'bg-gradient-to-br from-zinc-800 to-zinc-900 text-gray-100'
                    }`}
                >
                    <div className="text-xs mb-1 opacity-70">
                        {isUser ? 'You' : isError ? 'Error' : isSystem ? 'System' : 'Memox'}
                    </div>
                    <div className="whitespace-pre-wrap text-base leading-relaxed">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            children={message.content}
                            components={{
                                code({ node, inline, className, children, ...props }) {
                                    const match = /language-(\w+)/.exec(className || '');
                                    return !inline && match ? (
                                        <SyntaxHighlighter
                                            children={String(children).replace(/^\n$/, '')}
                                            // @ts-ignore - style prop expects a specific type, but dracula is compatible
                                            style={dracula}
                                            language={match[1]}
                                            PreTag="div"
                                            {...props}
                                        />
                                    ) : (
                                        <code className={className} {...props}>
                                            {children}
                                        </code>
                                    );
                                },
                            }}
                        />
                    </div>
                    {message.codeContext && (
                        <div className="mt-3 bg-black/70 rounded p-2 border border-zinc-700">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-400">{message.codeContext.file}</span>
                                <button
                                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                                    onClick={() => handleCopy(message.codeContext!.code)}
                                    title="Copy code"
                                >
                                    <Copy size={14} /> Copy
                                </button>
                            </div>
                            <pre className="text-sm overflow-x-auto">
                                <code>{message.codeContext.code}</code>
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Banner logic
    let banner = null;
    if (!modelStatus.isInstalled) {
        banner = (
            <div className={BANNER_STYLE + ' bg-yellow-700 text-white'}>
                <AlertCircle size={18} />
                Ollama is not installed. <a href="https://ollama.ai/download" target="_blank" rel="noopener noreferrer" className="underline ml-1">Install Ollama</a> to use local AI features.
                <button
                    className="ml-4 px-3 py-1 bg-blue-700 rounded text-white flex items-center gap-1 hover:bg-blue-800"
                    onClick={() => setShowCloud(true)}
                >
                    <Cloud size={16} /> Try Cloud
                </button>
            </div>
        );
    } else if (modelStatus.isInstalled && !modelStatus.isDownloaded) {
        banner = (
            <div className={BANNER_STYLE + ' bg-yellow-700 text-white'}>
                <AlertCircle size={18} />
                CodeLLaMA model is not downloaded. Run <span className="font-mono bg-black/30 px-2 py-1 rounded mx-1">ollama pull codellama:7b</span> in your terminal.
                <button
                    className="ml-4 px-3 py-1 bg-blue-700 rounded text-white flex items-center gap-1 hover:bg-blue-800"
                    onClick={() => setShowCloud(true)}
                >
                    <Cloud size={16} /> Try Cloud
                </button>
            </div>
        );
    } else if (modelStatus.mode === 'cloud') {
        banner = (
            <div className={BANNER_STYLE + ' bg-blue-900 text-blue-100'}>
                <Cloud size={18} />
                Using Cloud AI fallback (OpenAI/Sonar). Some features may be limited.
            </div>
        );
    } else if (modelStatus.mode === 'local') {
        banner = (
            <div className={BANNER_STYLE + ' bg-green-900 text-green-100'}>
                <span className="font-bold">Local AI</span> (Ollama: {modelStatus.modelName || 'CodeLLaMA'}) is active.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-gradient-to-br from-zinc-900 to-zinc-950 text-white">
            <div className="flex flex-col w-full max-w-2xl mx-auto h-full">
                {banner}
                <div className="flex-1 overflow-y-auto p-4 space-y-2 rounded-xl bg-black/30 shadow-inner border border-zinc-800 mt-2 mb-2">
                    {messages.length === 0 && !isLoading && (
                        <div className="text-center text-gray-400 mt-16">Ask a question or paste code for improvement...</div>
                    )}
                    {messages.map(renderMessage)}
                    {isLoading && (
                        <div className="flex justify-start mb-4">
                            <div className="bg-zinc-800 rounded-xl p-4 flex items-center gap-2">
                                <Loader2 className="animate-spin" size={20} />
                                <span>Memox is thinking...</span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
                <div className="flex items-center justify-between px-4 pb-4 gap-2">
                    <button
                        className="flex items-center gap-1 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-gray-300 text-xs"
                        onClick={handleClear}
                        title="Clear chat"
                    >
                        <Trash2 size={14} /> Clear
                    </button>
                    <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask a question or paste code for improvement..."
                            className="flex-1 bg-zinc-800 text-white rounded-lg p-2 resize-none border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-700"
                            rows={1}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit(e);
                                }
                            }}
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            className={`p-2 rounded-lg transition-colors flex items-center justify-center ${
                                isLoading
                                    ? 'bg-gray-600 cursor-not-allowed'
                                    : 'bg-blue-700 hover:bg-blue-800'
                            }`}
                            disabled={isLoading}
                            title="Send"
                        >
                            {isLoading ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                <Send size={20} />
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
} 
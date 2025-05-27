export interface Message {
  id: number;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  status?: 'success' | 'error' | 'warning';
  codeSnippet?: {
    language: string;
    content: string;
  };
}

export interface ModelStatus {
  ollamaInstalled: boolean;
  modelDownloaded: boolean;
  modelName: string;
  performance: 'low' | 'medium' | 'high';
}

export type ConnectionMode = 'offline' | 'online';

export interface ChatPanelProps {
  messages: Message[];
  inputValue: string;
  isLoading: boolean;
  connectionMode: ConnectionMode;
  modelStatus: ModelStatus;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}
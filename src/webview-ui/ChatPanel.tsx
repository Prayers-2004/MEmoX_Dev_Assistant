import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Cpu, Wifi, Settings, Code2, AlertCircle } from 'lucide-react';
import { Message, ModelStatus, ConnectionMode, ChatPanelProps } from './types';
import './style.css';

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  inputValue,
  isLoading,
  connectionMode,
  modelStatus,
  onInputChange,
  onSendMessage,
  onKeyDown,
  messagesEndRef
}) => {
  return (
    <div className="memox-chat-container">
      {/* Header */}
      <div className="memox-header">
        <div className="memox-title">
          <Sparkles className="memox-icon" />
          <h2>Memox AI</h2>
        </div>
        <div className="memox-status">
          <div className={`memox-connection ${connectionMode}`}>
            {connectionMode === 'offline' ? (
              <>
                <Cpu className="memox-icon-small" />
                <span>{modelStatus.modelName}</span>
              </>
            ) : (
              <>
                <Wifi className="memox-icon-small" />
                <span>Online</span>
              </>
            )}
          </div>
          <button className="memox-settings">
            <Settings className="memox-icon-small" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="memox-messages">
        {messages.map((message) => (
          <div key={message.id} className={`memox-message ${message.sender}`}>
            <div className={`memox-message-content ${message.sender}`}>
              <div className="memox-message-text">{message.content}</div>
              
              {message.codeSnippet && (
                <div className="memox-code-snippet">
                  <div className="memox-code-header">
                    <Code2 className="memox-icon-small" />
                    <span>{message.codeSnippet.language}</span>
                  </div>
                  <pre className="memox-code-content">{message.codeSnippet.content}</pre>
                </div>
              )}
              
              <div className="memox-message-footer">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {message.status === 'error' && <AlertCircle className="memox-icon-small error" />}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="memox-message ai">
            <div className="memox-message-content ai">
              <div className="memox-loading">
                <div className="memox-loading-dot"></div>
                <div className="memox-loading-dot" style={{ animationDelay: '0.2s' }}></div>
                <div className="memox-loading-dot" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="memox-input-container">
        <div className="memox-input-wrapper">
          <textarea
            value={inputValue}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder="Ask Memox about your code..."
            className="memox-textarea"
            rows={1}
          />
          <button
            onClick={onSendMessage}
            disabled={isLoading || inputValue.trim() === ''}
            className={`memox-send-button ${inputValue.trim() === '' ? 'disabled' : ''}`}
          >
            <Send className="memox-icon" />
          </button>
        </div>
        <div className="memox-input-footer">
          <span>
            {connectionMode === 'offline' ? (
              modelStatus.ollamaInstalled ? (
                modelStatus.modelDownloaded ? (
                  `Using ${modelStatus.modelName} (${modelStatus.performance})`
                ) : (
                  'Model not downloaded'
                )
              ) : (
                'Ollama not installed'
              )
            ) : (
              'Connected to Sonar API'
            )}
          </span>
          <span>Shift+Enter for new line</span>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
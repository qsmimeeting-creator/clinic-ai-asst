import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Mic } from 'lucide-react';
import MessageItem from './MessageItem';

interface Message {
  id: number;
  sender: string;
  type: string;
  text: string;
  isStreaming?: boolean;
  short_answer?: string;
  citations?: any[];
  conflicts?: any[];
  missing_fields?: any[];
  responseTime?: number;
}

interface ChatPanelProps {
  files: any[];
}

export default function ChatPanel({ files }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      sender: 'bot',
      type: 'welcome',
      text: 'สวัสดีครับ ผมคือผู้ช่วย AI ของคลินิก 🏥\nยินดีต้อนรับสู่ระบบช่วยเหลือข้อมูลอัตโนมัติ\n\nคุณสามารถสอบถามข้อมูลต่างๆ เกี่ยวกับบริการของคลินิกได้ทันทีครับ'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSpeechSupported(true);
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'th-TH';
      
      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputValue(prev => (prev ? prev + ' ' : '') + transcript);
      };
      
      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };
    }
  }, []);

  const handleMicClick = () => {
    if (!recognitionRef.current) {
      setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', type: 'system_error', text: 'เบราว์เซอร์ของคุณไม่รองรับการพิมพ์ด้วยเสียง (Speech-to-Text) ครับ กรุณาลองใช้ Chrome' }]);
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  const processMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const userMsg = { id: Date.now(), sender: 'user', type: 'text', text: text };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    const startTime = Date.now();
    const botMsgId = Date.now() + 1;
    setMessages(prev => [...prev, {
      id: botMsgId,
      sender: 'bot',
      type: 'answered',
      text: '',
      isStreaming: true
    }]);

    try {
      const activeFiles = files.filter(f => f.status === 'active');
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, activeFiles })
      });

      if (!response.ok) {
        let errorMessage = "Failed to connect to AI";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
        } catch (e) {
          errorMessage = `Server returned status ${response.status}`;
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("ReadableStream not supported");

      const decoder = new TextDecoder();
      let fullRawResponse = '';
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6).trim();
            if (dataStr === '[DONE]') break;
            
            try {
              const data = JSON.parse(dataStr);
              if (data.chunk) {
                fullRawResponse += data.chunk;
                
                let displayAnswer = "";
                
                const answerMatch = fullRawResponse.match(/"answer":\s*"((?:[^"\\]|\\.)*)/);
                if (answerMatch) {
                  displayAnswer = answerMatch[1]
                    .replace(/\\n/g, '\n')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\')
                    .replace(/\\t/g, '\t');
                } else if (fullRawResponse.trim().startsWith('{')) {
                  displayAnswer = "กำลังประมวลผลคำตอบ...";
                } else {
                  displayAnswer = fullRawResponse;
                }

                setMessages(prev => prev.map(m => 
                  m.id === botMsgId ? { ...m, text: displayAnswer } : m
                ));
              }
            } catch (e) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      const endTime = Date.now();
      const responseTime = (endTime - startTime) / 1000;

      try {
        const finalData = JSON.parse(fullRawResponse);
        setMessages(prev => prev.map(m => 
          m.id === botMsgId ? {
            ...m,
            type: finalData.status || 'answered',
            text: finalData.answer || m.text,
            short_answer: finalData.short_answer,
            citations: finalData.citations,
            conflicts: finalData.conflicts,
            missing_fields: finalData.missing_fields,
            isStreaming: false,
            responseTime
          } : m
        ));
      } catch (e) {
        console.error("Final JSON parse error:", e);
        setMessages(prev => prev.map(m => 
          m.id === botMsgId ? { ...m, isStreaming: false, responseTime } : m
        ));
      }

    } catch (error: any) {
      console.error("Chat error:", error);
      setMessages(prev => prev.map(m => 
        m.id === botMsgId ? {
          id: m.id,
          sender: 'bot',
          type: 'system_error',
          text: `ขออภัยครับ ระบบประมวลผลขัดข้องชั่วคราว: ${error.message || 'ไม่ทราบสาเหตุ'} กรุณาลองใหม่อีกครั้ง`,
          isStreaming: false
        } : m
      ));
    } finally {
      setIsTyping(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const textToSend = inputValue;
    setInputValue('');
    await processMessage(textToSend);
  };

  return (
    <>
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50/50">
        {messages.map((msg) => (
          <MessageItem 
            key={msg.id} 
            msg={msg} 
          />
        ))}

        {isTyping && !messages.some(m => m.isStreaming) && (
          <div className="flex justify-start">
            <div className="flex flex-row max-w-[80%]">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-[#fad4d8] mr-3 flex items-center justify-center overflow-hidden">
                <Bot size={18} className="text-[#B11226]" />
              </div>
              <div className="bg-white border border-gray-100 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center space-x-1.5">
                <div className="w-2 h-2 bg-[#B11226] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-[#B11226] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-[#B11226] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                <span className="text-xs text-gray-500 ml-2">กำลังค้นหาข้อมูลจากเอกสารคลินิก...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 flex flex-col shrink-0">
        {/* Chat Form */}
        <div className="p-4 pb-6 sm:pb-4">
          <form onSubmit={handleSendMessage} className="flex space-x-2 relative">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isListening ? "กำลังฟัง..." : "สอบถามข้อมูลวัคซีน ราคา หรือเวลาทำการ..."}
                className={`w-full bg-gray-100 border-transparent rounded-full pl-5 pr-12 py-3 sm:py-3 outline-none transition-all text-base sm:text-sm text-[#333333] ${
                  isListening ? 'ring-2 ring-red-400 bg-red-50' : 'focus:bg-white focus:ring-2 focus:ring-[#B11226]'
                }`}
                disabled={isTyping}
              />
              {isSpeechSupported && (
                <button
                  type="button"
                  onClick={handleMicClick}
                  disabled={isTyping}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all ${
                    isListening ? 'text-[#B11226] bg-[#fad4d8] animate-pulse' : 'text-gray-400 hover:text-[#B11226] hover:bg-gray-200'
                  }`}
                  title="พิมพ์ด้วยเสียง"
                >
                  <Mic size={18} />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!inputValue.trim() || isTyping}
              className={`rounded-full px-4 py-2 flex items-center justify-center transition-all ${
                inputValue.trim() && !isTyping 
                  ? 'bg-[#B11226] text-white hover:bg-[#8a0e1d] shadow-md hover:shadow-lg' 
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Send size={18} className={inputValue.trim() && !isTyping ? 'ml-0.5' : ''} />
            </button>
          </form>
          <div className="text-center mt-2">
            <p className="text-[10px] text-gray-400">
              AI อาจให้ข้อมูลที่ไม่ถูกต้อง โปรดตรวจสอบกับเจ้าหน้าที่คลินิกอีกครั้ง
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

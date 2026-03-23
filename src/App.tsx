import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, Settings, ArrowLeft, Database, Mic, AlertCircle } from 'lucide-react';

// Modularized Components
import AdminPanel from './components/AdminPanel';
import AuthModal from './components/AuthModal';
import MessageItem from './components/MessageItem';
import ErrorBoundary from './components/ErrorBoundary';

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

// --- REAL AI BACKEND (Using Gemini API with Context Stuffing & Multimodal) ---
// callGeminiAPI removed and integrated into processMessage for streaming support

// --- MAIN COMPONENTS ---
export default function App() {
  const [currentView, setCurrentView] = useState('chat'); // 'chat' | 'admin'
  const [categories, setCategories] = useState([]);
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // Increased to 30s

      const response = await fetch('/api/data', { signal: controller.signal });
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      if (response.ok) {
        setFiles(data.files || []);
        setCategories(data.categories || []);
      } else {
        setLoadError(data.message || data.error || "Server error fetching data");
      }
    } catch (error: any) {
      console.error("Failed to fetch data:", error);
      setLoadError(error.name === 'AbortError' ? "การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง" : "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
  
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const recognitionRef = useRef(null);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (currentView === 'chat') {
      scrollToBottom();
    }
  }, [messages, isTyping, currentView]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSpeechSupported(true);
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'th-TH';
      
      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);
      
      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputValue(prev => (prev ? prev + ' ' : '') + transcript);
      };
      
      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };
    }

    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
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

  const toggleSpeech = (text, id) => {
    if (!window.speechSynthesis) {
       setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', type: 'system_error', text: 'เบราว์เซอร์ของคุณไม่รองรับการอ่านออกเสียง (Text-to-Speech) ครับ' }]);
       return;
    }
    
    window.speechSynthesis.cancel();
    
    if (speakingId === id) {
      setSpeakingId(null);
      return;
    }
    
    const cleanText = text.replace(/[*_~`#]/g, '');
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // ตรวจสอบว่ามีภาษาไทยในข้อความหรือไม่
    const hasThai = /[ก-๙]/.test(cleanText);
    utterance.lang = hasThai ? 'th-TH' : 'en-US';
    
    utterance.rate = 1.0;
    
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  };

  // ฟังก์ชันหลักสำหรับส่งข้อความไปยัง AI
  const processMessage = async (text) => {
    if (!text.trim() || isTyping) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const userMsg = { id: Date.now(), sender: 'user', type: 'text', text: text };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    const startTime = Date.now();
    const botMsgId = Date.now() + 1;
    // เพิ่มข้อความเริ่มต้นของ AI (สถานะกำลังพิมพ์)
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
                
                // พยายามดึงคำตอบจาก JSON ที่กำลังสตรีมมา (ใช้ Regex สำหรับ Partial JSON)
                let displayAnswer = "";
                
                // ค้นหาเนื้อหาในฟิลด์ "answer"
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
              // ข้ามข้อผิดพลาดในการ parse สำหรับ chunk ที่ไม่สมบูรณ์
            }
          }
        }
      }

      // เมื่อสตรีมจบ พยายาม parse JSON ตัวเต็มเพื่อดึง metadata อื่นๆ
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

  // เมื่อผู้ใช้กด Enter หรือกดปุ่ม Submit
  const handleSendMessage = async (e) => {
    e.preventDefault();
    const textToSend = inputValue;
    setInputValue('');
    await processMessage(textToSend);
  };

  return (
    <div className="min-h-screen bg-gray-100 sm:py-6 sm:px-4 md:px-6 lg:px-8 font-sans flex justify-center sm:items-center text-[#333333] relative">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#B11226] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">กำลังเชื่อมต่อ Vercel Storage...</p>
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center space-y-4 p-6 bg-white rounded-xl shadow-lg max-w-sm text-center">
          <div className="bg-red-100 p-3 rounded-full text-red-600"><AlertCircle size={32} /></div>
          <h2 className="text-lg font-bold text-gray-900">การเชื่อมต่อขัดข้อง</h2>
          <p className="text-gray-600 text-sm">{loadError}</p>
          <button 
            onClick={fetchData}
            className="w-full py-2 bg-[#B11226] text-white rounded-lg hover:bg-[#8a0e1d] transition-colors font-medium"
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      ) : (
        <>
          <div className={`w-full bg-white sm:rounded-xl sm:shadow-xl overflow-hidden flex flex-col h-[100dvh] sm:h-[85vh] transition-all duration-300 ${currentView === 'admin' ? 'max-w-6xl' : 'max-w-2xl'}`}>
        
        {/* Header */}
        <div className="bg-[#B11226] px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            {currentView === 'admin' ? (
              <button onClick={() => setCurrentView('chat')} className="text-white hover:bg-[#8a0e1d] p-1.5 rounded-full transition-colors mr-1 shrink-0">
                <ArrowLeft size={20} />
              </button>
            ) : (
              <div className="bg-white p-1.5 sm:p-2 rounded-full flex items-center justify-center shadow-sm shrink-0">
                <Bot size={20} className="text-[#B11226] sm:w-6 sm:h-6" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-white font-bold text-base sm:text-lg leading-tight truncate">
                {currentView === 'admin' ? 'Knowledge Management' : 'Clinic AI Assistant'}
              </h1>
              <p className="text-[#fad4d8] text-[10px] sm:text-xs flex items-center mt-0.5 truncate">
                {currentView === 'admin' && (
                  <><Database size={10} className="mr-1 shrink-0" /> ระบบจัดการฐานความรู้หลังบ้าน</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0 ml-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-white text-xs font-medium pl-1 hidden sm:inline-block">Online</span>
            
            {currentView === 'chat' && (
              <button 
                onClick={() => setShowAuthModal(true)}
                className="ml-4 bg-[#8a0e1d] text-white p-2 rounded-full hover:bg-white hover:text-[#B11226] transition-colors shadow-sm border border-[#8a0e1d] hover:border-transparent"
                title="ระบบจัดการหลังบ้าน (Admin)"
              >
                <Settings size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Body Area */}
        {currentView === 'admin' ? (
          <AdminPanel 
            files={files} 
            setFiles={setFiles} 
            categories={categories} 
            setCategories={setCategories}
          />
        ) : (
          <>
            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50/50">
              {messages.map((msg) => (
                <MessageItem 
                  key={msg.id} 
                  msg={msg} 
                  speakingId={speakingId} 
                  toggleSpeech={toggleSpeech} 
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
              </div>

            </div>
          </>
        )}
      </div>

          {/* Admin Authentication Modal */}
          <AuthModal 
            showAuthModal={showAuthModal}
            setShowAuthModal={setShowAuthModal}
            onSuccess={() => setCurrentView('admin')}
          />
        </>
      )}
    </div>
  );
}

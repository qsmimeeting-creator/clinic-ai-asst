import React, { memo } from 'react';
import { User, Bot, FileText, Search, ShieldAlert, AlertTriangle, Info, Volume2, VolumeX, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
}

interface MessageItemProps {
  msg: Message;
  speakingId: number | null;
  toggleSpeech: (text: string, id: number) => void;
}

const MessageItem = memo(({ msg, speakingId, toggleSpeech }: MessageItemProps) => {
  const renderBotMessageContent = () => {
    switch (msg.type) {
      case 'welcome':
        return <div className="whitespace-pre-line text-[#333333]">{msg.text}</div>;
        
      case 'answered':
        return (
          <div className="space-y-3">
            {msg.short_answer && (
              <p className="font-bold text-[#B11226] text-lg border-b pb-2 border-gray-100">{msg.short_answer}</p>
            )}
            <div className="markdown-body text-[#333333] leading-relaxed">
              {msg.text === '' && msg.isStreaming ? (
                <div className="flex space-x-1 items-center h-6">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.text + (msg.isStreaming ? ' ▮' : '')}
                </ReactMarkdown>
              )}
            </div>
            
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-4 bg-[#fdf2f3] rounded-md p-3 border border-[#fad4d8] text-sm">
                <div className="flex items-center text-[#B11226] font-medium mb-1">
                  <FileText size={14} className="mr-1.5" />
                  แหล่งอ้างอิงจากคลินิก (Citations)
                </div>
                <ul className="list-none space-y-1.5">
                  {msg.citations.map((cite, idx) => (
                    <li key={idx} className="flex items-start text-[#B11226]/80">
                      <span className="inline-block w-4 text-center mr-1">•</span>
                      <span>
                        <span className="font-medium text-[#8a0e1d]">{cite.file_name}</span> 
                        {cite.locator && <span className="text-xs ml-1 bg-[#fad4d8] px-1.5 py-0.5 rounded text-[#B11226]">{cite.locator}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );

      case 'clarification_needed':
        return (
          <div className="space-y-4">
            <div className="flex items-start space-x-3 bg-orange-50/50 p-3 rounded-xl border border-orange-100">
              <div className="bg-orange-100 p-1.5 rounded-full shrink-0">
                <HelpCircle className="text-orange-600" size={18} />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-orange-900 text-sm">ต้องการข้อมูลเพิ่มเติม</p>
                <p className="text-gray-700 text-sm leading-relaxed">{msg.text}</p>
              </div>
            </div>
            
            {msg.missing_fields && msg.missing_fields.length > 0 && (
              <div className="pl-11">
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">กรุณาระบุข้อมูลดังนี้:</p>
                <div className="flex flex-wrap gap-2">
                  {msg.missing_fields.map((field, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white border border-orange-200 text-orange-700 px-3 py-1.5 rounded-lg text-sm shadow-sm flex items-center"
                    >
                      <span className="w-1.5 h-1.5 bg-orange-400 rounded-full mr-2"></span>
                      {field}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'out_of_scope':
        return (
          <div className="bg-red-50 p-3 rounded-md border border-red-100">
            <div className="flex items-center text-[#B11226] font-semibold mb-1">
              <ShieldAlert size={18} className="mr-1.5" />
              นอกเหนือขอบเขตการให้บริการ
            </div>
            <p className="text-[#333333] text-sm">{msg.text}</p>
          </div>
        );

      case 'conflict_detected':
        return (
          <div className="space-y-3">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
              <p className="text-[#333333]">{msg.text}</p>
            </div>
            {msg.conflicts && (
              <div className="bg-amber-50 p-3 rounded-md border border-amber-200 text-sm">
                <p className="font-semibold text-amber-800 mb-2">ข้อมูลที่พบความขัดแย้ง:</p>
                {msg.conflicts.map((conflict, idx) => (
                  <div key={idx} className="mb-2 last:mb-0">
                    <p className="font-medium text-amber-900">• {conflict.field}</p>
                    <ul className="pl-4 mt-1 space-y-1">
                      {conflict.values.map((val, vIdx) => (
                        <li key={vIdx} className="text-amber-700 text-xs">
                          - {val} <span className="text-amber-500">(จาก: {conflict.sources[vIdx]})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'no_answer':
        return (
          <div className="flex items-start space-x-2">
            <Info className="text-[#B11226] mt-0.5 flex-shrink-0" size={18} />
            <p className="text-[#333333]">{msg.text}</p>
          </div>
        );

      default:
        return <p className="text-[#333333]">{msg.text}</p>;
    }
  };

  return (
    <div className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center overflow-hidden ${
          msg.sender === 'user' ? 'bg-gray-200 ml-3' : 'bg-[#fad4d8] mr-3'
        }`}>
          {msg.sender === 'user' ? (
            <User size={16} className="text-gray-600" />
          ) : (
            <Bot size={18} className="text-[#B11226]" />
          )}
        </div>

        {/* Message Bubble */}
        <div className={`relative flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
          <div className={`px-4 py-3 rounded-2xl shadow-sm ${
            msg.sender === 'user' 
              ? 'bg-[#B11226] text-white rounded-tr-sm' 
              : 'bg-white border border-gray-100 rounded-tl-sm'
          }`}>
            {msg.sender === 'user' ? (
              <p className="whitespace-pre-line">{msg.text}</p>
            ) : (
              renderBotMessageContent()
            )}
          </div>
          
          {msg.sender === 'bot' && (
            <div className="flex items-center space-x-2 mt-1.5 ml-1">
              <button 
                onClick={() => toggleSpeech(msg.text, msg.id)} 
                className={`transition-colors p-1 ${speakingId === msg.id ? 'text-[#B11226]' : 'text-gray-400 hover:text-[#B11226]'}`}
                title={speakingId === msg.id ? 'หยุดอ่านเสียง' : 'อ่านออกเสียง'}
              >
                {speakingId === msg.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if the message text, streaming status, or speaking status changes
  return (
    prevProps.msg.text === nextProps.msg.text &&
    prevProps.msg.isStreaming === nextProps.msg.isStreaming &&
    prevProps.speakingId === nextProps.speakingId &&
    (prevProps.speakingId !== prevProps.msg.id && nextProps.speakingId !== nextProps.msg.id)
  );
});

export default MessageItem;

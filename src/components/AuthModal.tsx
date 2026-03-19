import React from 'react';
import { Lock, X, ShieldAlert } from 'lucide-react';

interface AuthModalProps {
  showAuthModal: boolean;
  setShowAuthModal: (show: boolean) => void;
  onSuccess: () => void;
}

const AuthModal = ({ 
  showAuthModal, 
  setShowAuthModal, 
  onSuccess
}: AuthModalProps) => {
  const [adminPassword, setAdminPassword] = React.useState('');
  const [authError, setAuthError] = React.useState('');

  if (!showAuthModal) return null;

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassword === 'Clinic') {
      onSuccess();
      setShowAuthModal(false);
      setAdminPassword('');
      setAuthError('');
    } else {
      setAuthError('รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-[#B11226]"></div>
        
        <button 
          onClick={() => setShowAuthModal(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-all"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center space-y-4">
          <div className="bg-[#fdf2f3] p-4 rounded-full text-[#B11226] mb-2">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Admin Access</h2>
          <p className="text-gray-500 text-sm">กรุณาระบุรหัสผ่านเพื่อเข้าสู่ระบบจัดการหลังบ้าน</p>
          
          <form onSubmit={handleAdminLogin} className="w-full space-y-4 pt-2">
            <div className="relative">
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                className={`w-full bg-gray-50 border ${authError ? 'border-red-500' : 'border-gray-200'} rounded-xl px-4 py-3.5 focus:ring-2 focus:ring-[#B11226] focus:border-transparent outline-none transition-all text-center text-lg tracking-widest`}
              />
              {authError && (
                <div className="flex items-center justify-center text-red-500 text-xs mt-2 font-medium">
                  <ShieldAlert size={12} className="mr-1" /> {authError}
                </div>
              )}
            </div>
            <button
              type="submit"
              className="w-full bg-[#B11226] text-white font-bold py-3.5 rounded-xl hover:bg-[#8a0e1d] transition-all shadow-lg hover:shadow-[#B11226]/20 transform hover:-translate-y-0.5 active:translate-y-0"
            >
              เข้าสู่ระบบ
            </button>
          </form>
          
          <p className="text-[10px] text-gray-300 pt-4 uppercase tracking-widest font-bold">Secure Environment</p>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;

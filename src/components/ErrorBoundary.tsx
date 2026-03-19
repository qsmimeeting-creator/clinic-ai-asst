import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-6 text-center bg-white rounded-xl shadow-sm border border-red-100 m-4">
          <div className="bg-red-100 p-4 rounded-full text-red-600 mb-4">
            <AlertTriangle size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">เกิดข้อผิดพลาดบางอย่าง</h2>
          <p className="text-gray-600 mb-6 max-w-md">
            ขออภัยครับ ระบบพบข้อผิดพลาดในการแสดงผล กรุณาลองรีเฟรชหน้าจอใหม่อีกครั้ง
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center px-6 py-2.5 bg-[#B11226] text-white rounded-lg hover:bg-[#8a0e1d] transition-colors shadow-md"
          >
            <RefreshCw size={18} className="mr-2" />
            รีเฟรชหน้าจอ
          </button>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-6 p-4 bg-gray-100 rounded text-left text-xs overflow-auto max-w-full text-red-800">
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

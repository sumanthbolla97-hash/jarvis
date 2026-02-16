
export interface TranscriptionItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete: boolean;
}

export interface LiveSessionState {
  isActive: boolean;
  isConnecting: boolean;
  error: string | null;
}


export interface TranscriptionEntry {
  role: 'user' | 'model' | 'tool';
  text: string;
  timestamp: number;
}

export enum SessionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface AppState {
  status: SessionStatus;
  isSharingScreen: boolean;
  isMicEnabled: boolean;
  transcriptions: TranscriptionEntry[];
  error: string | null;
}


import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';

interface ScreenStreamProps {
  isSharing: boolean;
  onStreamStarted: (stream: MediaStream) => void;
  onStreamStopped: () => void;
  onError?: (error: Error) => void;
}

export interface ScreenStreamHandle {
  getCanvas: () => HTMLCanvasElement | null;
  getVideo: () => HTMLVideoElement | null;
}

const ScreenStream = forwardRef<ScreenStreamHandle, ScreenStreamProps>(({ isSharing, onStreamStarted, onStreamStopped, onError }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    getVideo: () => videoRef.current
  }));

  useEffect(() => {
    let stream: MediaStream | null = null;
    let mounted = true;

    const startCapture = async () => {
      try {
        // Options for screen sharing
        const displayMediaOptions = {
          video: { 
            frameRate: { ideal: 15, max: 30 }
          },
          audio: {
            // IMPORTANT: For capturing system audio (game sounds), we want raw audio.
            // Echo cancellation is for microphones. Enabling it on system audio can cause weird artifacts.
            echoCancellation: false, 
            noiseSuppression: false, 
            autoGainControl: false   
          }
        };

        stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        
        if (!mounted) {
           stream.getTracks().forEach(track => track.stop());
           return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Mute local video element to prevent feedback loop if system audio is captured and played back locally
          videoRef.current.muted = true; 
        }
        
        onStreamStarted(stream);

        stream.getVideoTracks()[0].onended = () => {
          onStreamStopped();
        };
      } catch (err: any) {
        console.error("Error sharing screen:", err);
        if (mounted) {
            if (onError) onError(err);
            onStreamStopped();
        }
      }
    };

    if (isSharing) {
      startCapture();
    } else {
      // Cleanup if isSharing becomes false
      if (videoRef.current?.srcObject) {
        const currentStream = videoRef.current.srcObject as MediaStream;
        currentStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      mounted = false;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isSharing]); 

  return (
    <div className="relative w-full h-full bg-slate-900 rounded-xl border border-slate-700 overflow-hidden flex items-center justify-center group">
      {isSharing ? (
        <>
          <video 
            ref={videoRef} 
            autoPlay 
            muted 
            playsInline 
            className="w-full h-full object-contain"
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute top-4 left-4 bg-red-500/80 text-white text-xs font-bold px-2 py-1 rounded animate-pulse uppercase tracking-wider shadow-lg">
            Live Optics & Audio
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center space-y-4 opacity-50 group-hover:opacity-100 transition-opacity">
          <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center border-2 border-dashed border-slate-600">
             <svg className="w-10 h-10 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
             </svg>
          </div>
          <p className="text-slate-400 font-medium">Screen Capture Inactive</p>
        </div>
      )}
    </div>
  );
});

export default ScreenStream;

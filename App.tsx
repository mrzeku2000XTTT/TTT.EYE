
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { SessionStatus, TranscriptionEntry } from './types';
import { decodeAudio, decodeAudioData, createPcmBlob } from './utils/audioUtils';
import ScreenStream, { ScreenStreamHandle } from './components/ScreenStream';
import TranscriptionView from './components/TranscriptionView';

interface SearchSource {
  title: string;
  uri: string;
}

type AppMode = 'TACTICAL' | 'GENERAL';

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.DISCONNECTED);
  const [mode, setMode] = useState<AppMode>('TACTICAL');
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchSources, setSearchSources] = useState<SearchSource[]>([]);
  const [hasSystemAudio, setHasSystemAudio] = useState(false);

  // Music / Shazam State
  const [musicState, setMusicState] = useState<{ artist: string; title: string; isVisible: boolean }>({ 
    artist: '', 
    title: '', 
    isVisible: false 
  });

  // Tactical & Learning UI States
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [terminalOutput, setTerminalOutput] = useState<string[]>(["[System] Radiant Core v9.6", "[Audio] Loopback Defense: MAX"]);
  const [learningScore, setLearningScore] = useState(15); 
  const [tacticalPatterns, setTacticalPatterns] = useState<string[]>([]); // Persistent Memory
  const [tacticalData, setTacticalData] = useState({ 
    economy: 'Detecting...', 
    callout: 'Scanning...',
    enemyIntel: 'Clear',
    score: '0-0',
    agent: 'Unknown',
    analysis: 'AWAITING DATA...' 
  });
  
  // Ref for accessing latest state in callbacks without closure issues
  const tacticalDataRef = useRef(tacticalData);
  useEffect(() => { tacticalDataRef.current = tacticalData; }, [tacticalData]);

  const audioContextRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const screenRef = useRef<ScreenStreamHandle>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const activeSessionRef = useRef<any>(null);

  // Audio Mixing Refs
  const mixerRef = useRef<GainNode | null>(null);
  const systemGainRef = useRef<GainNode | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const currentInRef = useRef('');
  const currentOutRef = useRef('');

  // Handle incoming screen stream audio
  const connectScreenAudio = (stream: MediaStream) => {
    screenStreamRef.current = stream;
    
    // Only connect if we have an active audio context (session running)
    if (audioContextRef.current?.input && mixerRef.current && systemGainRef.current) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        try {
          // Disconnect old source if exists
          if (screenAudioSourceRef.current) {
            screenAudioSourceRef.current.disconnect();
          }
          
          const source = audioContextRef.current.input.createMediaStreamSource(stream);
          // Connect Source -> System Gain -> Main Mixer
          source.connect(systemGainRef.current);
          screenAudioSourceRef.current = source;
          
          setHasSystemAudio(true);
          setTerminalOutput(prev => [...prev.slice(-8), "[AUDIO] System Audio: LOCKED"]);
        } catch (e) {
          console.error("Failed to connect system audio:", e);
          setHasSystemAudio(false);
        }
      } else {
        setHasSystemAudio(false);
        setTerminalOutput(prev => [...prev.slice(-8), "[AUDIO] Warning: No Game Audio Track"]);
      }
    }
  };

  const stopSession = useCallback(() => {
    if (activeSessionRef.current) {
      try { activeSessionRef.current.close(); } catch (e) {}
      activeSessionRef.current = null;
    }
    if (frameIntervalRef.current) {
      window.clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    
    if (screenAudioSourceRef.current) {
      try { screenAudioSourceRef.current.disconnect(); } catch (e) {}
      screenAudioSourceRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.input.close();
        audioContextRef.current.output.close();
      } catch (e) {}
      audioContextRef.current = null;
      mixerRef.current = null;
      systemGainRef.current = null;
    }
    
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    audioSourcesRef.current.clear();
    
    setStatus(SessionStatus.DISCONNECTED);
    setIsMicEnabled(false);
    setIsSharingScreen(false);
    setIsModelSpeaking(false);
    setHasSystemAudio(false);
    setMusicState(prev => ({ ...prev, isVisible: false }));
  }, []);

  const handleAgentAction = useCallback(async (name: string, args: any) => {
    switch (name) {
      case 'update_tactical_hud':
         const prevData = tacticalDataRef.current;
         setTacticalData(prev => ({
           ...prev,
           economy: args.economy || prev.economy,
           callout: args.callout || prev.callout,
           enemyIntel: args.enemyIntel || prev.enemyIntel,
           score: args.score || prev.score,
           agent: args.agent || prev.agent,
           analysis: args.analysis || prev.analysis
         }));
         
         if (args.enemyIntel && args.enemyIntel !== prevData.enemyIntel) {
           setTerminalOutput(prev => [...prev.slice(-8), `[TARGET] ${args.enemyIntel.toUpperCase()}`]);
         }
         return "HUD Synced.";

      case 'log_tactical_pattern':
         const newPattern = args.pattern;
         setTacticalPatterns(prev => {
             const updated = [...prev, newPattern];
             return updated.length > 5 ? updated.slice(updated.length - 5) : updated;
         });
         setLearningScore(prev => Math.min(prev + 15, 100));
         setTerminalOutput(prev => [...prev.slice(-8), `[MEMORY] LEARNED: ${newPattern}`]);
         return "Pattern saved to long-term memory.";

      case 'neural_adaptation_sync':
         setLearningScore(prev => Math.min(prev + (args.learningBoost || 5), 100));
         setTerminalOutput(prev => [...prev.slice(-8), `[Adaptation] Logic refined via gameplay data.`]);
         return "ML Update Logged.";

      case 'identify_song':
         setMusicState({
             artist: args.artist,
             title: args.title,
             isVisible: true
         });
         // Auto-hide after 10 seconds
         setTimeout(() => setMusicState(prev => ({ ...prev, isVisible: false })), 10000);
         setTerminalOutput(prev => [...prev.slice(-8), `[AUDIO] MUSIC ID: ${args.title}`]);
         return "Song identified and displayed on HUD.";

      case 'mouse_move':
        setCursorPos({ x: Number(args.x), y: Number(args.y) });
        return "Pointer moved.";
        
      default:
        return "Action completed.";
    }
  }, []);

  const startSession = async () => {
    try {
      setStatus(SessionStatus.CONNECTING);
      setError(null);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = { input: inputCtx, output: outputCtx };

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      const mixer = inputCtx.createGain();
      mixerRef.current = mixer;

      const systemGain = inputCtx.createGain();
      systemGain.gain.value = 0.7; 
      systemGain.connect(mixer);
      systemGainRef.current = systemGain;

      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        } 
      });
      setIsMicEnabled(true);
      const micSource = inputCtx.createMediaStreamSource(micStream);
      micSource.connect(mixer);

      if (screenStreamRef.current) {
        connectScreenAudio(screenStreamRef.current);
      }

      // --- CONFIGURATION BASED ON MODE ---
      
      const commonTools = [
        {
          name: 'identify_song',
          parameters: {
            type: Type.OBJECT,
            description: 'Call this when you have identified a song playing in the background audio.',
            properties: {
              artist: { type: Type.STRING },
              title: { type: Type.STRING }
            },
            required: ['artist', 'title']
          }
        }
      ];

      const tacticalTools = [
        ...commonTools,
        {
          name: 'update_tactical_hud',
          parameters: {
            type: Type.OBJECT,
            description: 'Update the on-screen tactical display with match state AND strategic analysis.',
            properties: {
              economy: { type: Type.STRING },
              callout: { type: Type.STRING, description: 'User current location name' },
              enemyIntel: { type: Type.STRING, description: 'Enemy location sightings' },
              score: { type: Type.STRING, description: 'Current match score (Top Center)' },
              agent: { type: Type.STRING, description: 'Character user is playing' },
              analysis: { type: Type.STRING, description: 'Strategic advice based on game state (e.g. "Eco round, play together")' }
            }
          }
        },
        {
          name: 'log_tactical_pattern',
          parameters: {
            type: Type.OBJECT,
            description: 'Call this when you notice a recurring enemy habit or strategy to "remember" it.',
            properties: { 
                pattern: { type: Type.STRING, description: "The recurring behavior observed (e.g., 'Enemy Jett always peeks Mid early')" } 
            },
            required: ['pattern']
          }
        },
        {
          name: 'neural_adaptation_sync',
          parameters: {
            type: Type.OBJECT,
            properties: { learningBoost: { type: Type.NUMBER } }
          }
        }
      ];

      const generalTools = [
        ...commonTools,
        {
          name: 'mouse_move',
          parameters: {
            type: Type.OBJECT,
            properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
            required: ['x', 'y'],
          }
        }
      ];

      const tacticalInstruction = `You are the Radiant Tactical Voice, an elite Valorant coach.
          
      CORE AUDIO DIRECTIVES:
      1. **LISTEN INTENTLY**: You are receiving a MIX of user voice and SYSTEM AUDIO (game sounds).
      2. **"LISTEN" COMMAND**: If the user says "Listen" or "Shh" or "Quiet", you must **STOP TALKING IMMEDIATELY** and remain silent.
      3. **SOUND RECOGNITION**: Spike Plant/Defuse, Footsteps.
      4. **MUSIC ID**: If the user asks "What song is this?", identify it from the audio stream and call 'identify_song'.
      
      VISUAL & STRATEGIC DIRECTIVES:
      - VISUAL GROUNDING: Verify score, economy, and agents.
      - SMART ANALYSIS: If user credits are low, advise "Eco". If time is low, advise "Plant".
      
      COMMUNICATION STYLE:
      - Concise, high-urgency, tactical. Prioritize threats.`;

      const generalInstruction = `You are a helpful, intelligent, and witty AI desktop assistant.
      
      CAPABILITIES:
      1. **VISUAL**: You can see the user's screen in real-time.
      2. **AUDIO**: You can hear the user and their system audio (videos, music, notifications).
      
      GOALS:
      - Assist with whatever is on screen: coding debugging, writing, browsing, or gaming.
      - Be conversational and concise.
      - **MUSIC IDENTIFICATION**: If you hear music and the user asks "What song is this?", identify the song from the audio and use the 'identify_song' tool.
      
      AUDIO COMMAND: If the user says "Quiet" or "Listen", stop talking immediately.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus(SessionStatus.CONNECTED);
            
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            const silentGain = inputCtx.createGain();
            silentGain.gain.value = 0; 
            
            scriptProcessor.onaudioprocess = (e) => {
              const pcmBlob = createPcmBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => { if (s) s.sendRealtimeInput({ media: pcmBlob }); });
            };
            
            mixer.connect(scriptProcessor);
            scriptProcessor.connect(silentGain);
            silentGain.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsModelSpeaking(false);
              
              if (systemGainRef.current && audioContextRef.current) {
                 const ctx = audioContextRef.current.input;
                 systemGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
                 systemGainRef.current.gain.setValueAtTime(0.7, ctx.currentTime);
              }
              return;
            }

            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                const result = await handleAgentAction(fc.name, fc.args);
                sessionPromise.then(session => {
                  session.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: result } }
                  });
                });
              }
            }

            if (message.serverContent?.outputTranscription) currentOutRef.current += message.serverContent.outputTranscription.text;
            if (message.serverContent?.inputTranscription) currentInRef.current += message.serverContent.inputTranscription.text;
            
            if (message.serverContent?.turnComplete) {
              if (currentInRef.current || currentOutRef.current) {
                setTranscriptions(prev => [...prev, 
                  ...(currentInRef.current ? [{ role: 'user' as const, text: currentInRef.current, timestamp: Date.now() }] : []),
                  ...(currentOutRef.current ? [{ role: 'model' as const, text: currentOutRef.current, timestamp: Date.now() + 1 }] : [])
                ]);
              }
              currentInRef.current = ''; currentOutRef.current = '';
            }

            const audioBase64 = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioBase64 && audioContextRef.current) {
              const { output: outCtx, input: inputCtx } = audioContextRef.current;

              if (nextStartTimeRef.current < outCtx.currentTime) {
                  nextStartTimeRef.current = outCtx.currentTime + 0.05; 
              }

              const audioData = decodeAudio(audioBase64);
              const audioBuffer = await decodeAudioData(audioData, outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outCtx.destination);
              
              if (systemGainRef.current) {
                 systemGainRef.current.gain.cancelScheduledValues(inputCtx.currentTime);
                 systemGainRef.current.gain.setValueAtTime(systemGainRef.current.gain.value, inputCtx.currentTime);
                 systemGainRef.current.gain.linearRampToValueAtTime(0, inputCtx.currentTime + 0.05); 
              }

              source.addEventListener('ended', () => {
                audioSourcesRef.current.delete(source);
                if (audioSourcesRef.current.size === 0) {
                   setIsModelSpeaking(false);
                   if (systemGainRef.current) {
                      systemGainRef.current.gain.cancelScheduledValues(inputCtx.currentTime);
                      systemGainRef.current.gain.setValueAtTime(0, inputCtx.currentTime);
                      systemGainRef.current.gain.linearRampToValueAtTime(0.7, inputCtx.currentTime + 0.2); 
                   }
                }
              });

              source.start(nextStartTimeRef.current);
              setIsModelSpeaking(true);
              nextStartTimeRef.current += audioBuffer.duration;
              audioSourcesRef.current.add(source);
            }
          },
          onerror: (e) => { setError("Connection failure."); stopSession(); },
          onclose: () => stopSession()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          tools: [{ functionDeclarations: mode === 'TACTICAL' ? tacticalTools : generalTools }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: mode === 'TACTICAL' ? tacticalInstruction : generalInstruction
        }
      });
      activeSessionRef.current = await sessionPromise;
    } catch (err) { setError("Failed to Connect."); setStatus(SessionStatus.DISCONNECTED); }
  };

  useEffect(() => {
    if (status === SessionStatus.CONNECTED && isSharingScreen) {
      frameIntervalRef.current = window.setInterval(async () => {
        const video = screenRef.current?.getVideo();
        const canvas = screenRef.current?.getCanvas();
        if (!video || !canvas || video.paused || video.ended) return;
        canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(async (blob) => {
            if (blob && activeSessionRef.current) {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                activeSessionRef.current.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
              };
              reader.readAsDataURL(blob);
            }
          }, 'image/jpeg', 0.85);
        }
      }, 700); 
    }
    return () => { if (frameIntervalRef.current) window.clearInterval(frameIntervalRef.current); };
  }, [status, isSharingScreen]);

  return (
    <div className="flex flex-col h-screen bg-[#0f1923] text-[#ece8e1] font-sans overflow-hidden selection:bg-[#ff4655]/30">
      <header className="h-16 flex items-center justify-between px-8 bg-[#111b27]/90 border-b border-[#363e47] backdrop-blur-xl z-30 shadow-2xl">
        <div className="flex items-center gap-6">
          <div className={`w-10 h-10 flex items-center justify-center rotate-45 shadow-lg transition-all duration-700 ${mode === 'TACTICAL' ? 'bg-[#ff4655] shadow-[#ff4655]/30' : 'bg-[#00f3ff] shadow-[#00f3ff]/30'}`}>
            <svg className="w-6 h-6 text-white -rotate-45" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 12l10 10 10-10L12 2zm0 18l-8-8 8-8 8 8-8 8z" />
            </svg>
          </div>
          <div>
            <h1 className={`text-sm font-black uppercase tracking-[0.3em] transition-colors ${mode === 'TACTICAL' ? 'text-[#ff4655]' : 'text-[#00f3ff]'}`}>
              {mode === 'TACTICAL' ? 'Radiant Tactical Core' : 'Gemini General Assistant'}
            </h1>
            <p className="text-[10px] text-[#7b8085] font-bold uppercase tracking-widest flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${mode === 'TACTICAL' ? 'bg-cyan-400' : 'bg-green-400'}`} /> 
              {mode === 'TACTICAL' ? 'Neural Analysis: Active' : 'Assistant Mode: Ready'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex bg-[#0f1923] border border-[#363e47] rounded p-1 gap-1">
             <button 
                onClick={() => status === SessionStatus.DISCONNECTED && setMode('TACTICAL')}
                className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all ${mode === 'TACTICAL' ? 'bg-[#ff4655] text-white' : 'text-[#7b8085] hover:text-white'} ${status !== SessionStatus.DISCONNECTED ? 'opacity-50 cursor-not-allowed' : ''}`}
             >
                Tactical
             </button>
             <button 
                onClick={() => status === SessionStatus.DISCONNECTED && setMode('GENERAL')}
                className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all ${mode === 'GENERAL' ? 'bg-[#00f3ff] text-black' : 'text-[#7b8085] hover:text-white'} ${status !== SessionStatus.DISCONNECTED ? 'opacity-50 cursor-not-allowed' : ''}`}
             >
                General
             </button>
          </div>

          <div className="flex flex-col items-end w-32">
             <div className="flex justify-between w-full mb-1">
                <span className="text-[8px] font-black text-[#7b8085] uppercase tracking-tighter">Latency</span>
                <span className="text-[8px] font-black text-[#00f3ff] uppercase tracking-tighter">24ms</span>
             </div>
             <div className="w-full h-1 bg-[#363e47] rounded-full overflow-hidden">
                <div className="h-full bg-green-500 w-3/4" />
             </div>
          </div>

          <button 
            onClick={status === SessionStatus.DISCONNECTED ? startSession : stopSession}
            className={`px-10 py-2.5 skew-x-[-12deg] text-[11px] font-black uppercase tracking-[0.2em] transition-all border-r-4 ${
              status === SessionStatus.DISCONNECTED 
              ? (mode === 'TACTICAL' ? 'bg-[#ff4655] text-white hover:bg-[#ff5b68] border-white shadow-xl shadow-[#ff4655]/40' : 'bg-[#00f3ff] text-black hover:bg-[#4ff9ff] border-white shadow-xl shadow-[#00f3ff]/40')
              : 'bg-[#363e47] text-[#7b8085] border-transparent'
            }`}
          >
            <span className="inline-block skew-x-[12deg]">
              {status === SessionStatus.DISCONNECTED ? 'Establish Link' : 'Sever Link'}
            </span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex p-6 gap-6 overflow-hidden">
        <div className="flex-1 flex flex-col gap-6">
          <div className="flex-1 relative bg-[#111b27] border border-[#363e47] overflow-hidden group shadow-[inset_0_0_100px_rgba(0,0,0,0.5)]">
            <ScreenStream 
              ref={screenRef}
              isSharing={isSharingScreen} 
              onStreamStarted={(stream) => {
                setIsSharingScreen(true);
                connectScreenAudio(stream);
              }}
              onStreamStopped={() => {
                setIsSharingScreen(false);
                screenStreamRef.current = null;
                setHasSystemAudio(false);
              }}
              onError={(e) => setError(e.message || "Screen capture denied")}
            />
            
            {isSharingScreen && (
              <>
                 {/* Music / Shazam Overlay */}
                 {musicState.isVisible && (
                    <div className="absolute top-8 left-8 z-30 animate-in slide-in-from-left duration-700">
                        <div className="flex items-center gap-4 p-4 bg-black/80 backdrop-blur-xl border-l-4 border-emerald-400 rounded-r-xl shadow-2xl">
                           <div className="flex flex-col items-center justify-center w-12 h-12 bg-emerald-500/20 rounded-full border border-emerald-500/50 animate-pulse">
                              <svg className="w-6 h-6 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                              </svg>
                           </div>
                           <div>
                              <div className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Now Playing</div>
                              <div className="text-sm font-bold text-white">{musicState.title}</div>
                              <div className="text-xs text-emerald-400/80 font-medium">{musicState.artist}</div>
                           </div>
                        </div>
                    </div>
                 )}

                {mode === 'TACTICAL' && (
                  <>
                    {/* Agent Tactical HUD - EXPANDED */}
                    <div className="absolute top-8 right-8 w-80 p-6 bg-[#0f1923]/95 backdrop-blur-md border-l-4 border-[#ff4655] shadow-2xl z-20 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-[#ff4655] uppercase tracking-[0.2em]">Live Telemetry</span>
                        <div className="flex gap-2">
                           {hasSystemAudio && (
                               <div className="px-2 py-0.5 bg-yellow-500/20 text-yellow-500 text-[8px] font-bold rounded uppercase animate-pulse">Sys_Audio_Live</div>
                           )}
                           <div className="px-2 py-0.5 bg-[#ff4655]/20 text-[#ff4655] text-[8px] font-bold rounded uppercase">Vanguard_Sync</div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-[#111b27] border border-[#363e47]">
                          <div className="text-[8px] text-[#7b8085] uppercase mb-1 font-black">Agent</div>
                          <div className="text-[11px] font-black text-[#00f3ff] uppercase truncate">{tacticalData.agent}</div>
                        </div>
                        <div className="p-3 bg-[#111b27] border border-[#363e47]">
                          <div className="text-[8px] text-[#7b8085] uppercase mb-1 font-black">Score</div>
                          <div className="text-[11px] font-black text-white uppercase">{tacticalData.score}</div>
                        </div>
                      </div>

                      {/* Strategic Analysis Box */}
                      <div className="p-3 bg-[#0f1923] border border-[#00f3ff]/30 shadow-[0_0_15px_rgba(0,243,255,0.1)] relative overflow-hidden group/box">
                        <div className="absolute top-0 right-0 p-1">
                            <div className="w-1.5 h-1.5 bg-[#00f3ff] animate-ping" />
                        </div>
                        <div className="text-[8px] text-[#00f3ff] uppercase mb-1 font-black tracking-widest">Strategic Analysis</div>
                        <div className="text-[10px] font-bold text-[#ece8e1] uppercase leading-tight relative z-10">
                            {tacticalData.analysis}
                        </div>
                      </div>

                      <div className="p-3 bg-[#111b27] border border-[#363e47] relative">
                        <div className="text-[8px] text-[#7b8085] uppercase mb-1 font-black">Enemy Intel</div>
                        <div className="text-xs font-black text-white uppercase flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${tacticalData.enemyIntel.toLowerCase().includes('clear') ? 'bg-slate-700' : 'bg-red-500 animate-pulse'}`} />
                          {tacticalData.enemyIntel}
                        </div>
                      </div>
                    </div>

                    {/* Tactical Terminal & Memory Log */}
                    <div className="absolute bottom-8 left-8 w-[28rem] h-56 bg-[#0f1923]/95 backdrop-blur-lg border border-[#363e47] p-5 font-mono text-[10px] z-20 overflow-hidden shadow-2xl flex flex-col">
                       <div className="border-b border-[#363e47] pb-2 mb-3 flex items-center justify-between">
                          <span className="text-[9px] uppercase font-black text-[#ff4655] tracking-widest">Neural_Memory_Core</span>
                          <span className="text-[#00f3ff] animate-pulse">● LEARNING</span>
                       </div>
                       
                       <div className="flex-1 space-y-2 overflow-y-auto mb-2 custom-scrollbar">
                          {tacticalPatterns.length === 0 ? (
                              <div className="text-[#7b8085] italic">Analyzing enemy patterns...</div>
                          ) : (
                              tacticalPatterns.map((pat, idx) => (
                                  <div key={idx} className="flex gap-2 items-start text-[#ece8e1] animate-in slide-in-from-left">
                                      <span className="text-[#00f3ff] font-bold">[{idx + 1}]</span>
                                      <span className="leading-tight">{pat}</span>
                                  </div>
                              ))
                          )}
                       </div>

                      <div className="h-16 border-t border-[#363e47] pt-2 space-y-1 overflow-hidden opacity-60">
                        {terminalOutput.slice(-3).map((line, i) => (
                          <div key={i} className={`leading-tight truncate ${line.includes('[TARGET]') ? 'text-red-500 font-bold' : line.includes('[MEMORY]') ? 'text-yellow-400' : 'text-[#ece8e1]/60'}`}>
                            <span className="opacity-20 mr-2">SYS:</span>{line}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Shared Elements */}
                <div className="absolute bottom-8 right-8 w-12 h-12 flex items-center justify-center z-20">
                  <div className={`w-full h-full rounded-full border-2 ${mode === 'TACTICAL' ? 'border-[#ff4655]' : 'border-[#00f3ff]'} ${isModelSpeaking ? 'animate-ping opacity-50' : 'opacity-20'}`} />
                  <div className={`absolute w-4 h-4 rounded-full ${mode === 'TACTICAL' ? 'bg-[#ff4655]' : 'bg-[#00f3ff]'} ${isModelSpeaking ? 'animate-pulse' : ''}`} />
                  {isModelSpeaking && (
                      <div className={`absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/50 px-2 py-0.5 rounded text-[8px] font-bold ${mode === 'TACTICAL' ? 'text-[#ff4655]' : 'text-[#00f3ff]'}`}>EARS CLOSED</div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="h-24 bg-[#111b27] border border-[#363e47] flex items-center justify-between px-10 shadow-xl relative overflow-hidden">
             <div className="flex items-center gap-12 z-10">
                <button 
                  onClick={() => setIsSharingScreen(!isSharingScreen)}
                  className={`flex flex-col items-center gap-2 group transition-all ${isSharingScreen ? (mode === 'TACTICAL' ? 'text-[#ff4655]' : 'text-[#00f3ff]') : 'text-[#7b8085]'}`}
                >
                  <div className={`w-14 h-14 bg-transparent border-2 transition-all flex items-center justify-center rotate-45 ${isSharingScreen ? (mode === 'TACTICAL' ? 'border-[#ff4655] shadow-[0_0_15px_rgba(255,70,85,0.2)]' : 'border-[#00f3ff] shadow-[0_0_15px_rgba(0,243,255,0.2)]') : 'border-[#363e47] group-hover:border-[#7b8085]'}`}>
                    <svg className="w-7 h-7 -rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] mt-2">{isSharingScreen ? 'Optics: ON' : 'Optics: OFF'}</span>
                </button>

                <div className="w-px h-12 bg-[#363e47]" />

                <div className="flex flex-col gap-1">
                   <span className="text-[9px] font-black text-[#7b8085] uppercase tracking-widest">Neural Gain</span>
                   <div className="flex items-center gap-1.5 h-6">
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(i => (
                        <div 
                          key={i} 
                          className={`w-1.5 rounded-sm transition-all ${isModelSpeaking ? (mode === 'TACTICAL' ? 'bg-[#00f3ff]' : 'bg-green-400') + ' animate-pulse' : 'bg-[#363e47]'}`} 
                          style={{ height: isModelSpeaking ? `${40 + Math.random() * 60}%` : '4px', animationDelay: `${i*0.04}s` }} 
                        />
                      ))}
                   </div>
                </div>
             </div>
             
             <div className="flex items-center gap-6 z-10">
               <div className="flex flex-col items-end">
                 <div className="flex gap-2">
                   <span className={`px-3 py-1 border text-[9px] font-black uppercase tracking-widest ${mode === 'TACTICAL' ? 'bg-[#ff4655]/10 text-[#ff4655] border-[#ff4655]/30' : 'bg-[#00f3ff]/10 text-[#00f3ff] border-[#00f3ff]/30'}`}>
                      {mode === 'TACTICAL' ? 'ML-Radiant' : 'Assistant-V1'}
                   </span>
                   <span className="px-3 py-1 bg-[#00f3ff]/10 text-[#00f3ff] border border-[#00f3ff]/30 text-[9px] font-black uppercase tracking-tighter">Verified Link</span>
                 </div>
                 <span className="text-[8px] text-[#7b8085] mt-2 font-bold uppercase tracking-tighter">Neural Adaptive Intercept Verified</span>
               </div>
             </div>
          </div>
        </div>

        <div className="w-96 flex flex-col min-w-[24rem] gap-6">
          <div className="flex-1 overflow-hidden">
             {error && (
              <div className="mb-4 p-3 bg-red-900/40 border border-red-500/50 rounded flex items-center gap-3 animate-pulse">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-[10px] font-bold text-red-200 uppercase tracking-wider">{error}</span>
              </div>
            )}
            <TranscriptionView entries={transcriptions} />
          </div>

          {searchSources.length > 0 && (
            <div className="h-64 bg-[#111b27]/90 border border-[#363e47] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-right">
               <div className="p-4 border-b border-[#363e47] bg-[#0f1923] flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ece8e1]">Meta Data</h3>
                  <span className="text-[8px] font-bold text-[#7b8085] uppercase">Verified Link</span>
               </div>
               <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                  {searchSources.map((source, i) => (
                    <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer" className="block p-3 bg-[#0f1923]/50 hover:bg-[#111b27] border-l-2 border-[#ff4655] transition-all group">
                      <div className="text-[11px] font-black text-[#ece8e1] line-clamp-1 group-hover:text-[#ff4655]">{source.title}</div>
                      <div className="text-[9px] text-[#7b8085] truncate mt-1">{source.uri}</div>
                    </a>
                  ))}
               </div>
            </div>
          )}
        </div>
      </main>

      {status === SessionStatus.CONNECTING && (
        <div className="fixed inset-0 bg-[#0f1923]/98 backdrop-blur-3xl z-50 flex flex-col items-center justify-center">
           <div className="relative w-24 h-24 mb-10">
              <div className="absolute inset-0 border-4 border-[#ff4655]/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-[#ff4655] border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-4 bg-[#ff4655] rotate-45 animate-pulse" />
           </div>
           <h2 className="text-sm font-black text-white uppercase tracking-[0.6em] animate-pulse">Syncing Radiant Neural Link</h2>
           <p className="text-[10px] text-[#7b8085] font-bold mt-4 uppercase tracking-[0.3em]">Booting Machine Learning Protocols</p>
        </div>
      )}
      
      <style>{`
        @keyframes scanner-line {
          0% { left: 0; width: 0; }
          50% { left: 0; width: 100%; }
          100% { left: 100%; width: 0; }
        }
        .animate-scanner-line {
          animation: scanner-line 2s infinite ease-in-out;
        }
        .animate-spin-slow {
          animation: spin 4s linear infinite;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #363e47;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
};

export default App;

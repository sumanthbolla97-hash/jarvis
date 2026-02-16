
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { TranscriptionItem, LiveSessionState } from './types';
import { createBlob } from './utils/audioUtils';
import ResponseDisplay from './components/ResponseDisplay';

const App: React.FC = () => {
  const [activeResponse, setActiveResponse] = useState<TranscriptionItem | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [isUserAnswering, setIsUserAnswering] = useState<boolean>(false);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [resumeContent, setResumeContent] = useState(localStorage.getItem('jarvis_resume') || '');
  
  const [sessionState, setSessionState] = useState<LiveSessionState>({
    isActive: false,
    isConnecting: false,
    error: null,
  });

  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamingTextRef = useRef<string>('');
  const questionAccumulatorRef = useRef<string>('');
  const isUserAnsweringRef = useRef<boolean>(false);
  const lastTurnWasCompleteRef = useRef<boolean>(true);
  const responseInProgressRef = useRef<boolean>(false);

  // Sync ref with state for use inside callbacks to avoid stale closures
  useEffect(() => {
    isUserAnsweringRef.current = isUserAnswering;
  }, [isUserAnswering]);

  const saveResume = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('jarvis_resume', resumeContent);
    setIsResumeModalOpen(false);
    
    if (sessionRef.current && sessionState.isActive) {
      sessionRef.current.sendRealtimeInput({
        text: `SYSTEM UPDATE: Architect Knowledge Layer synchronized: ${resumeContent}. Maintain Senior Principal Persona.`
      });
    }
  };

  const stopSession = async () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setSessionState({ isActive: false, isConnecting: false, error: null });
    responseInProgressRef.current = false;
  };

  const startSession = async () => {
    if (sessionState.isConnecting || sessionState.isActive) return;
    
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === 'YOUR_API_KEY') {
      setSessionState({ 
        isActive: false, 
        isConnecting: false, 
        error: 'API Key Missing: Please configure the API_KEY environment variable.' 
      });
      return;
    }

    setSessionState({ isActive: false, isConnecting: true, error: null });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      await inputCtx.resume();
      audioContextRef.current = inputCtx;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setSessionState({ isActive: true, isConnecting: false, error: null });
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // 1. PROCESS INPUT TRANSCRIPTION (USER SPEECH)
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              if (text) {
                if (lastTurnWasCompleteRef.current) {
                  questionAccumulatorRef.current = '';
                  // Logic: If NOT in answering mode, clear previous AI output to make room for new sequence.
                  // If IN answering mode, we keep the previous output visible as a reference.
                  if (!isUserAnsweringRef.current) {
                    setActiveResponse(null);
                    streamingTextRef.current = '';
                  }
                  setCurrentQuestion('');
                  lastTurnWasCompleteRef.current = false;
                }
                questionAccumulatorRef.current += text;
                setCurrentQuestion(questionAccumulatorRef.current);
              }
            }

            // 2. PROCESS MODEL OUTPUT (AI RESPONSE)
            const textChunk = message.serverContent?.modelTurn?.parts?.[0]?.text || 
                             message.serverContent?.outputTranscription?.text;

            if (textChunk) {
              /**
               * Logic Check:
               * - If Answering is ON and a response was NOT already in progress: SKIP (Ignore new trigger)
               * - If Answering is ON but a response WAS already in progress: CONTINUE (Don't stop generating)
               */
              if (isUserAnsweringRef.current && !responseInProgressRef.current) {
                return;
              }

              // Set flag to true - we are now in the middle of a generation turn
              responseInProgressRef.current = true;
              
              streamingTextRef.current += textChunk;
              setActiveResponse({
                id: 'stream',
                role: 'model',
                text: streamingTextRef.current,
                timestamp: Date.now(),
                isComplete: false
              });
            }

            // 3. HANDLE TURN COMPLETION
            if (message.serverContent?.turnComplete) {
              lastTurnWasCompleteRef.current = true;
              responseInProgressRef.current = false; // Turn finished - new turns can now be blocked if locked
              setActiveResponse(prev => prev ? { ...prev, isComplete: true } : null);
            }
          },
          onerror: (err) => {
            console.error('Session Error:', err);
            setSessionState(prev => ({ ...prev, error: 'Connection failure. Check credentials and internet.' }));
            stopSession();
          },
          onclose: () => stopSession()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          thinkingConfig: { thinkingBudget: 0 },
          systemInstruction: `STRICT OPERATIONAL DIRECTIVE:
1. IDENTITY: You are Jarvis, a Senior Principal Software Architect and Technical Leader.
2. DOMAIN EXPERTISE: Expert in .NET Core, Azure Cloud Architecture, SQL Server performance, PL/SQL optimization, and Angular Signals/State Management.
3. LANGUAGE: ENGLISH ONLY. Strictly professional, technical, and direct.
4. NO META-TALK: Never include conversational fillers, greetings ("Hello"), or acknowledgments ("Sure, I can help"). 
5. ARCHITECTURAL DEPTH: Provide extensive, high-level architectural insights and performance-focused details.
6. CONCRETE EXAMPLES: Always include real-world enterprise use cases and implementation examples.
7. CONTEXT: ${resumeContent || 'N/A'}`,
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Initialization Error:', err);
      let userMsg = 'Connection refused.';
      const errStr = err?.toString() || '';
      if (errStr.includes('API_KEY_INVALID')) userMsg = 'Invalid API Key Configuration.';
      else if (err?.name === 'NotAllowedError') userMsg = 'Microphone access is required.';
      setSessionState({ isActive: false, isConnecting: false, error: userMsg });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white text-black overflow-hidden font-sans selection:bg-black selection:text-white">
      {/* Header / Command Center */}
      <header className="h-16 px-10 flex items-center justify-between shrink-0 border-b border-neutral-100 bg-white/80 backdrop-blur-md z-40">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <div className={`w-1.5 h-1.5 rounded-full ${sessionState.isActive ? (isUserAnswering ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]' : 'bg-black animate-pulse') : 'bg-neutral-200'}`}></div>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-neutral-900">
              {isUserAnswering ? 'Answering Active' : 'Jarvis Online'}
            </span>
          </div>
          {sessionState.isActive && (
            <>
              <div className="h-4 w-[1px] bg-neutral-100"></div>
              <span className={`text-[10px] font-medium uppercase tracking-widest ${isUserAnswering ? 'text-orange-400' : 'text-neutral-300 animate-pulse'}`}>
                {isUserAnswering ? 'User Monologue' : 'Processing Stream...'}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center space-x-3 h-full py-3">
          <button 
            onClick={() => setIsResumeModalOpen(true)} 
            className="h-full px-5 text-[9px] font-black uppercase tracking-widest border border-neutral-100 rounded-sm text-neutral-400 hover:text-black hover:bg-neutral-50 transition-all"
          >
            Architect Knowledge
          </button>
          <button 
            onClick={sessionState.isActive ? stopSession : startSession} 
            className={`h-full px-8 text-[9px] font-black uppercase tracking-widest rounded-sm transition-all shadow-sm active:scale-95 ${sessionState.isActive ? 'bg-white text-red-500 border border-red-100 hover:bg-red-50' : 'bg-black text-white hover:bg-neutral-800'}`}
          >
            {sessionState.isConnecting ? 'LINKING...' : sessionState.isActive ? 'TERMINATE' : 'INITIALIZE'}
          </button>
        </div>
      </header>

      {/* Primary Interaction Space */}
      <main className="flex-1 overflow-hidden bg-white relative">
        <div className="h-full overflow-y-auto px-10 pt-24 pb-48 no-scrollbar scroll-smooth">
          <div className="max-w-4xl mx-auto w-full">
            
            {/* Real-time Transcription of User Audio */}
            {currentQuestion && (
              <div className="mb-12 animate-in fade-in slide-in-from-top-4 duration-500 max-w-2xl border-l-2 border-neutral-100 pl-6 py-1">
                <span className={`text-[8px] font-bold uppercase tracking-[0.4em] block mb-2 ${isUserAnswering ? 'text-orange-500' : 'text-neutral-400'}`}>
                  {isUserAnswering ? 'Monologue Input' : 'Command Stream'}
                </span>
                <p className={`text-sm font-medium tracking-tight italic leading-relaxed transition-colors duration-300 ${isUserAnswering ? 'text-neutral-400' : 'text-neutral-400'}`}>
                  {currentQuestion}
                </p>
              </div>
            )}

            {/* AI Architect Response Display */}
            {activeResponse && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                <ResponseDisplay item={activeResponse} />
              </div>
            )}

            {!currentQuestion && !activeResponse && (
              <div className="h-[55vh] flex flex-col justify-center items-center">
                <div className="opacity-[0.02] select-none pointer-events-none text-center">
                  <h1 className="text-[10vw] font-black tracking-[-0.05em] leading-none uppercase">Jarvis</h1>
                  <p className="text-[1vw] uppercase tracking-[2.5em] ml-[2.5em]">Standby for Audio</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Answering Sidebar Toggle - Controls New AI Response Initiation */}
        <button 
          onClick={() => setIsUserAnswering(!isUserAnswering)}
          className={`fixed right-0 top-1/2 -translate-y-1/2 z-50 flex items-center h-56 w-14 rounded-l-3xl shadow-2xl transition-all duration-500 transform active:scale-95 group overflow-hidden border-y border-l ${isUserAnswering ? 'bg-orange-500 border-orange-400 translate-x-0' : 'bg-white border-neutral-100 translate-x-4 hover:translate-x-0'}`}
          title={isUserAnswering ? "Stop Answering Mode (Resume AI Replies)" : "Start Answering Mode (Block New AI Replies)"}
        >
          <div className="flex flex-col items-center justify-center w-full h-full space-y-4">
            <span className={`text-[10px] font-black uppercase tracking-[0.4em] vertical-text transform rotate-180 transition-colors duration-300 ${isUserAnswering ? 'text-white' : 'text-neutral-300 group-hover:text-black'}`}>
              {isUserAnswering ? 'STOP ANSWERING' : 'ANSWERING'}
            </span>
            <div className={`w-2 h-2 rounded-full transition-all duration-300 ${isUserAnswering ? 'bg-white scale-110 shadow-lg' : 'bg-neutral-200 group-hover:bg-black'}`}></div>
          </div>
        </button>
      </main>

      {/* Architect Knowledge Overlay */}
      {isResumeModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-white/70 backdrop-blur-2xl animate-in fade-in duration-300">
          <div className="w-full max-w-xl bg-white border border-neutral-100 p-12 rounded-sm shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)]">
            <h2 className="text-[10px] font-black uppercase tracking-[0.5em] mb-10 text-center text-neutral-400">Contextual Core</h2>
            <form onSubmit={saveResume}>
              <textarea 
                className="w-full h-80 border border-neutral-100 rounded-sm p-8 font-mono text-[11px] focus:outline-none focus:border-black resize-none bg-neutral-50/30 leading-relaxed transition-all focus:bg-white" 
                placeholder="Inject architectural context, infrastructure constraints, or technical specifications..." 
                value={resumeContent} 
                onChange={(e) => setResumeContent(e.target.value)} 
              />
              <div className="flex justify-center mt-12 space-x-6">
                <button type="button" onClick={() => setIsResumeModalOpen(false)} className="px-8 py-3 text-[10px] font-black uppercase tracking-widest text-neutral-300 hover:text-black transition-colors">Abort</button>
                <button type="submit" className="px-12 py-3 bg-black text-white font-black uppercase tracking-widest text-[10px] rounded-sm shadow-xl active:scale-95 transition-all">Synchronize</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Toast Error Handling */}
      {sessionState.error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-10 py-4 text-[10px] font-black uppercase tracking-[0.2em] rounded-sm shadow-[0_20px_50px_rgba(0,0,0,0.3)] z-[70] animate-in slide-in-from-bottom-10 flex items-center space-x-4">
          <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
          <span>{sessionState.error}</span>
          <button 
            onClick={() => setSessionState(prev => ({ ...prev, error: null }))}
            className="ml-4 text-neutral-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      <style>{`
        .vertical-text {
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default App;

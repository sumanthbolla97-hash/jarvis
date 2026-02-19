
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { TranscriptionItem, LiveSessionState } from './types';
import { createBlob } from './utils/audioUtils';
import ResponseDisplay from './components/ResponseDisplay';

const App: React.FC = () => {
  const [activeResponse, setActiveResponse] = useState<TranscriptionItem | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [isUserAnswering, setIsUserAnswering] = useState<boolean>(false);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [resumeContent, setResumeContent] = useState(localStorage.getItem('jarvis_resume') || '');
  
  const [sessionState, setSessionState] = useState<LiveSessionState>({
    isActive: false,
    isConnecting: false,
    error: null,
  });

  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const userInitiatedStopRef = useRef<boolean>(false);
  const lastSessionErrorRef = useRef<string | null>(null);
  const streamingTextRef = useRef<string>('');
  const questionAccumulatorRef = useRef<string>('');
  const currentQuestionRef = useRef<string>('');
  const lockedTopicRef = useRef<string>('');
  const isUserAnsweringRef = useRef<boolean>(false);
  const lastTurnWasCompleteRef = useRef<boolean>(true);
  const responseInProgressRef = useRef<boolean>(false);

  useEffect(() => {
    isUserAnsweringRef.current = isUserAnswering;
  }, [isUserAnswering]);

  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  const sanitizeModelOutput = (rawText: string): string => {
    return rawText
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !(
          trimmed.startsWith('AUTO TASK:') ||
          trimmed.startsWith('Topic lock:') ||
          trimmed.startsWith('Do not change topic.') ||
          trimmed.startsWith('Do not restart from scratch.') ||
          trimmed.startsWith('Expand the current explanation')
        );
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const appendChunkWithSpacing = (current: string, chunk: string): string => {
    if (!current) return chunk;
    if (!chunk) return current;

    const prevChar = current[current.length - 1];
    const nextChar = chunk[0];
    const needsSpace =
      /[A-Za-z0-9\)]/.test(prevChar) &&
      /[A-Za-z0-9\(]/.test(nextChar) &&
      prevChar !== '\n' &&
      nextChar !== '\n';

    return needsSpace ? `${current} ${chunk}` : `${current}${chunk}`;
  };

  const isEnglishLike = (text: string): boolean => {
    // Enforce basic English-character stream for the question interception panel.
    return !/[^\u0000-\u007F]/.test(text);
  };

  const triggerAutoAnswer = () => {
    if (!sessionRef.current || !sessionState.isActive) return;
    const lockedTopic = lockedTopicRef.current || currentQuestionRef.current;

    sessionRef.current.sendRealtimeInput({
      text: `AUTO TASK CONTINUATION:
Topic lock: ${lockedTopic || 'Use the latest user discussion context.'}
English only.
Fast output required.
Output in this exact order:
[TECHNICAL_DEFINITION] (first line immediately, max 25 words)
[EXPLANATION] (crisp and practical, minimum 120 words)
[EXAMPLES]
[FLOW_DIAGRAM]
Use Knowledge Layer context directly for project-specific points.
Continue same topic only.`
    });
  };

  const toggleAnsweringMode = () => {
    const next = !isUserAnsweringRef.current;
    isUserAnsweringRef.current = next;
    setIsUserAnswering(next);

    if (next) {
      const latestTopic = currentQuestionRef.current.trim() || lockedTopicRef.current.trim();
      if (latestTopic) {
        lockedTopicRef.current = latestTopic;
      }
      responseInProgressRef.current = false;
      setActiveResponse({
        id: 'stream',
        role: 'model',
        text: '[TECHNICAL_DEFINITION]\nGenerating...',
        timestamp: Date.now(),
        isComplete: false
      });
      triggerAutoAnswer();
    } else {
      // Reset the screen state when leaving Answering mode so new questions start cleanly.
      setCurrentQuestion('');
      setActiveResponse(null);
      questionAccumulatorRef.current = '';
      currentQuestionRef.current = '';
      streamingTextRef.current = '';
      currentTurnTextRef.current = '';
      responseInProgressRef.current = false;
      lastTurnWasCompleteRef.current = true;
    }
  };

  const saveResume = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('jarvis_resume', resumeContent);
    setIsResumeModalOpen(false);
    
    if (sessionRef.current && sessionState.isActive) {
      sessionRef.current.sendRealtimeInput({
        text: `SYSTEM UPDATE: Architect Knowledge Layer synchronized: ${resumeContent}. Maintain maximum theoretical depth and provide exhaustive code implementations.`
      });
    }
  };

  const stopSession = async (opts?: { error?: string | null; initiatedByClose?: boolean }) => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    try {
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
      }

      if (sessionRef.current && !opts?.initiatedByClose) {
        sessionRef.current.close();
      }
      sessionRef.current = null;

      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }

      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      const finalError = opts?.error ?? null;
      if (finalError) {
        lastSessionErrorRef.current = finalError;
      }
      setSessionState({ isActive: false, isConnecting: false, error: finalError });
      responseInProgressRef.current = false;
    } finally {
      isStoppingRef.current = false;
    }
  };

  const startSession = async () => {
    if (sessionState.isConnecting || sessionState.isActive) return;
    userInitiatedStopRef.current = false;
    lastSessionErrorRef.current = null;
    
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === 'YOUR_API_KEY') {
      setSessionState({ 
        isActive: false, 
        isConnecting: false, 
        error: 'API Key Missing: Please ensure the API_KEY environment variable is set in your project settings or secrets.' 
      });
      return;
    }

    setSessionState({ isActive: false, isConnecting: true, error: null });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
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
            const scriptProcessor = inputCtx.createScriptProcessor(1024, 1, 1);
            scriptProcessorRef.current = scriptProcessor;
            scriptProcessor.onaudioprocess = (e) => {
              // Pause live mic transcription while answering mode is enabled.
              if (isUserAnsweringRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle User Audio Transcription
            if (message.serverContent?.inputTranscription) {
              if (!isUserAnsweringRef.current) {
                const text = message.serverContent.inputTranscription.text;
                if (text) {
                  if (!isEnglishLike(text)) {
                    setCurrentQuestion('English only input detected. Please speak in English.');
                    return;
                  }

                  if (lastTurnWasCompleteRef.current) {
                    questionAccumulatorRef.current = '';
                    // In Answering mode, we keep the old response as context/reference.
                    if (!isUserAnsweringRef.current) {
                      setActiveResponse(null);
                      streamingTextRef.current = '';
                    }
                    setCurrentQuestion('');
                    lastTurnWasCompleteRef.current = false;
                  }
                  questionAccumulatorRef.current += text;
                  setCurrentQuestion(questionAccumulatorRef.current);
                  lockedTopicRef.current = questionAccumulatorRef.current;
                }
              }
            }

            // Handle Model Output (AI Response)
            const modelPartsText = message.serverContent?.modelTurn?.parts
              ?.map((part: any) => part?.text || '')
              .join('') || '';
            const textChunk =
              message.text ||
              modelPartsText ||
              message.serverContent?.outputTranscription?.text;

            if (textChunk) {
              const cleanedChunk = sanitizeModelOutput(textChunk);
              if (!cleanedChunk) return;

              // Keep panel stable in Answering mode; append deeper explanation to existing answer.
              if (isUserAnsweringRef.current && !responseInProgressRef.current && streamingTextRef.current) {
                streamingTextRef.current += '\n\n';
              }
              responseInProgressRef.current = true;
              streamingTextRef.current = appendChunkWithSpacing(streamingTextRef.current, cleanedChunk);
              setActiveResponse({
                id: 'stream',
                role: 'model',
                text: streamingTextRef.current,
                timestamp: Date.now(),
                isComplete: false
              });
            }

            if (message.serverContent?.turnComplete) {
              lastTurnWasCompleteRef.current = true;
              responseInProgressRef.current = false;
              if (currentQuestionRef.current) {
                lockedTopicRef.current = currentQuestionRef.current;
              }
              setActiveResponse(prev => prev ? { ...prev, isComplete: true } : null);
            }
          },
          onerror: (err) => {
            console.error('Session Error:', err);
            const errorMsg = err?.toString().includes('401') ? 'Authentication Failed: Invalid API Key.' : 'Connection failure. Check credentials.';
            lastSessionErrorRef.current = errorMsg;
            stopSession({ error: errorMsg });
          },
          onclose: (e: any) => {
            const reason = e?.reason ? ` (${e.reason})` : '';
            const code = e?.code ? ` [code ${e.code}]` : '';
            const error = userInitiatedStopRef.current
              ? null
              : (lastSessionErrorRef.current || `Session closed unexpectedly${reason}${code}. Please initialize again.`);
            userInitiatedStopRef.current = false;
            stopSession({ initiatedByClose: true, error });
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          thinkingConfig: { thinkingBudget: 0 },
          systemInstruction: `MANDATORY RULES:
1. English only.
2. Fast response is required.
3. Output order:
[TECHNICAL_DEFINITION]
[EXPLANATION]
[EXAMPLES]
[FLOW_DIAGRAM]
4. Stream [TECHNICAL_DEFINITION] first and immediately in 1-2 short sentences.
5. [EXPLANATION] must be crisp, practical, and at least 120 words.
6. Include one short code example and one short ASCII flow diagram.
7. Do not change topic unless user asks.
8. Use readable sentence spacing.
9. For project-related queries, integrate Knowledge Layer context directly in [TECHNICAL_DEFINITION], [EXPLANATION], and [EXAMPLES].
10. Prioritize low latency while preserving clarity.
9. If user asks anything about the project, you must integrate Knowledge Layer context directly into the answer.
10. For project-related questions, generate real-time, project-specific examples grounded in that Knowledge Layer context.

CONTEXT: ${resumeContent || 'N/A'}`,
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Init Error:', err);
      let userMsg = 'Connection refused.';
      if (err?.name === 'NotAllowedError') userMsg = 'Microphone access is mandatory for this interface.';
      setSessionState({ isActive: false, isConnecting: false, error: userMsg });
    }
  };

  return (
    <div className="h-screen bg-white text-black overflow-hidden font-sans selection:bg-black selection:text-white">
      <header className="fixed top-0 left-0 right-0 h-10 z-40 border-b border-neutral-100 bg-white/90 backdrop-blur-md">
        <div className="h-full grid grid-cols-3 items-center px-3">
          <div className="relative justify-self-start">
            <button
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="h-9 w-9 rounded-sm border border-neutral-100 text-[12px] font-black text-neutral-600 hover:text-black hover:bg-neutral-50 transition-colors"
              title={isMenuOpen ? 'Close Menu' : 'Open Menu'}
            >
              ≡
            </button>
            {isMenuOpen && (
              <div className="absolute left-0 top-11 w-52 bg-white border border-neutral-100 rounded-sm shadow-[0_16px_32px_-12px_rgba(0,0,0,0.2)] p-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-2 px-2 py-2 border-b border-neutral-100">
                  <div className={`w-1.5 h-1.5 rounded-full ${sessionState.isActive ? (isUserAnswering ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]' : 'bg-black animate-pulse') : 'bg-neutral-200'}`}></div>
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] text-neutral-900">
                    {isUserAnswering ? 'Answering Enabled' : 'Jarvis Online'}
                  </span>
                </div>
                <button
                  onClick={() => { setIsResumeModalOpen(true); setIsMenuOpen(false); }}
                  className="mt-2 h-10 w-full rounded-sm border border-neutral-100 text-[8px] font-black uppercase tracking-[0.2em] text-neutral-500 hover:text-black hover:bg-neutral-50 transition-colors"
                >
                  Knowledge Layer
                </button>
              </div>
            )}
          </div>

          <div className="justify-self-center flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${sessionState.isActive ? (isUserAnswering ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]' : 'bg-black animate-pulse') : 'bg-neutral-200'}`}></div>
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-neutral-900">
                {isUserAnswering ? 'Answering Enabled' : 'Jarvis Online'}
              </span>
            </div>
            <button
              onClick={toggleAnsweringMode}
              className={`h-9 px-4 text-[8px] font-black uppercase tracking-[0.2em] rounded-sm transition-all shadow-sm active:scale-95 border ${isUserAnswering ? 'bg-orange-500 text-white border-orange-400' : 'bg-white text-neutral-600 border-neutral-100 hover:text-black hover:bg-neutral-50'}`}
              title={isUserAnswering ? "Stop Answering Mode (Resume AI Replies)" : "Start Answering Mode (Lock AI Replies)"}
            >
              {isUserAnswering ? 'Stop Answering' : 'Answering'}
            </button>
            <button
              onClick={sessionState.isActive ? (() => { userInitiatedStopRef.current = true; stopSession(); }) : startSession}
              className={`h-9 px-6 text-[8px] font-black uppercase tracking-[0.2em] rounded-sm transition-all shadow-sm active:scale-95 ${sessionState.isActive ? 'bg-white text-red-500 border border-red-100 hover:bg-red-50' : 'bg-black text-white hover:bg-neutral-800'}`}
            >
              {sessionState.isConnecting ? 'Linking...' : sessionState.isActive ? 'Terminate' : 'Initialize'}
            </button>
          </div>

          <div className="justify-self-end pr-8 sm:pr-10">
            {sessionState.isActive && (
              <span className={`text-[8px] font-medium uppercase tracking-[0.2em] ${isUserAnswering ? 'text-orange-400' : 'text-neutral-300 animate-pulse'}`}>
                {isUserAnswering ? 'Monologue active' : 'Receiving stream...'}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="h-full overflow-hidden bg-white relative pt-10">
        <div className="h-full overflow-y-auto px-3 sm:px-5 pt-2 pb-8 no-scrollbar scroll-smooth">
          <div className="max-w-6xl mx-auto w-full">
            {currentQuestion && (
              <div className="mb-2 animate-in fade-in slide-in-from-top-4 duration-500 max-w-4xl border-l-2 border-neutral-100 pl-3 py-0.5">
                <span className={`text-[7px] font-bold uppercase tracking-[0.3em] block mb-0.5 ${isUserAnswering ? 'text-orange-500' : 'text-neutral-300'}`}>
                  {isUserAnswering ? 'Observation Stream' : 'Input Fragment'}
                </span>
                <p className="text-sm sm:text-base font-medium tracking-tight italic leading-normal text-neutral-500">
                  {currentQuestion}
                </p>
              </div>
            )}

            {activeResponse && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                <ResponseDisplay item={activeResponse} />
              </div>
            )}

            {!currentQuestion && !activeResponse && (
              <div className="h-[42vh] flex flex-col justify-start pt-6 items-center">
                <div className="opacity-[0.03] select-none pointer-events-none text-center">
                  <h1 className="text-[11vw] font-black tracking-[-0.05em] leading-none uppercase">Jarvis</h1>
                  <p className="text-[0.9vw] uppercase tracking-[2.2em] ml-[2.2em]">Standby for analysis</p>
                </div>
              </div>
            )}
          </div>
        </div>

      </main>

      {isResumeModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-white/70 backdrop-blur-2xl animate-in fade-in duration-300">
          <div className="w-full max-w-xl bg-white border border-neutral-100 p-12 rounded-sm shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)]">
            <h2 className="text-[10px] font-black uppercase tracking-[0.5em] mb-10 text-center text-neutral-400">Contextual Matrix</h2>
            <form onSubmit={saveResume}>
              <textarea 
                className="w-full h-80 border border-neutral-100 rounded-sm p-8 font-mono text-[11px] focus:outline-none focus:border-black resize-none bg-neutral-50/30 leading-relaxed transition-all focus:bg-white" 
                placeholder="Paste technical documentation or project specifics..." 
                value={resumeContent} 
                onChange={(e) => setResumeContent(e.target.value)} 
              />
              <div className="flex justify-center mt-12 space-x-6">
                <button type="button" onClick={() => setIsResumeModalOpen(false)} className="px-8 py-3 text-[10px] font-black uppercase tracking-widest text-neutral-300 hover:text-black transition-colors">Discard</button>
                <button type="submit" className="px-12 py-3 bg-black text-white font-black uppercase tracking-widest text-[10px] rounded-sm shadow-xl active:scale-95 transition-all">Synchronize</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {sessionState.error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-10 py-4 text-[10px] font-black uppercase tracking-[0.2em] rounded-sm shadow-[0_20px_50px_rgba(0,0,0,0.3)] z-[70] animate-in slide-in-from-bottom-10 flex items-center space-x-4">
          <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
          <span className="flex-1">{sessionState.error}</span>
          <button onClick={() => setSessionState(prev => ({ ...prev, error: null }))} className="ml-4 text-neutral-500 hover:text-white transition-colors">x</button>
        </div>
      )}

      <style>{`
        .vertical-text { writing-mode: vertical-rl; text-orientation: mixed; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default App;

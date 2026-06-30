import React, { useEffect, useState, useRef } from "react";
import Peer, { MediaConnection, DataConnection } from "peerjs";
import {
  Mic,
  MonitorUp,
  Headphones,
  Users,
  Crown,
  Radio,
  Volume2,
  AlertCircle,
  Link2,
  Square,
  Copy,
  CheckCircle2
} from "lucide-react";

export default function App() {
  const [peerId, setPeerId] = useState<string | null>(null);
  const [roomIdToJoin, setRoomIdToJoin] = useState<string>("");
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listenerCount, setListenerCount] = useState(0);
  const [volume, setVolume] = useState(1);
  const [copied, setCopied] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<Peer | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number>(0);
  
  // Track listener connections
  const connectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const dataConnectionsRef = useRef<Map<string, DataConnection>>(new Map());

  // Initialize PeerJS based on URL or manually
  useEffect(() => {
    // Check if URL has ?room=
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomIdToJoin(roomParam);
    }
  }, []);

  const initializePeer = (isHostMode: boolean, specificId?: string) => {
    setError(null);
    const peer = new Peer(specificId || "", {
      debug: 2
    });

    peer.on("open", (id) => {
      setPeerId(id);
      setIsConnected(true);
      if (isHostMode) {
        setIsHost(true);
        setActiveRoomId(id);
        // Update URL to make it shareable
        window.history.replaceState({}, "", `?room=${id}`);
      }
    });

    peer.on("error", (err) => {
      console.error("PeerJS error:", err);
      setError(`Connection error: ${err.type}`);
      setIsConnected(false);
    });

    // If I am the HOST, I will receive connections (data or media)
    // Actually, listeners will call the host to get the stream? 
    // Or host will call listeners?
    // Let's have the listener just connect data channel, and host calls back.
    peer.on("connection", (conn) => {
      if (!isHostMode) return;
      console.log("New listener joined:", conn.peer);
      
      conn.on('open', () => {
         dataConnectionsRef.current.set(conn.peer, conn);
         // When listener connects, if we are streaming, call them!
         if (localStreamRef.current) {
           const call = peer.call(conn.peer, localStreamRef.current);
           connectionsRef.current.set(conn.peer, call);
         }
         setListenerCount(dataConnectionsRef.current.size);
      });
      
      conn.on('close', () => {
         console.log("Listener left:", conn.peer);
         dataConnectionsRef.current.delete(conn.peer);
         const call = connectionsRef.current.get(conn.peer);
         if (call) {
           call.close();
           connectionsRef.current.delete(conn.peer);
         }
         setListenerCount(dataConnectionsRef.current.size);
      });
    });

    // If I am a LISTENER, I will receive calls from the Host
    peer.on("call", (call) => {
      console.log("Received call from host");
      call.answer(); // Answer automatically without our own stream
      
      call.on("stream", (remoteStream) => {
        console.log("Received host stream");
        if (audioRef.current) {
          audioRef.current.srcObject = remoteStream;
          audioRef.current.play().catch(e => {
            console.error("Autoplay prevented", e);
            setError("Autoplay blocked. Please click anywhere to enable audio.");
          });
          setupVisualizer(remoteStream);
        }
      });
      
      call.on("close", () => {
        console.log("Host ended call");
        if (audioRef.current) audioRef.current.srcObject = null;
        setIsListening(false);
        stopVisualizer();
      });
    });

    peerRef.current = peer;
  };

  const setupVisualizer = (stream: MediaStream) => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      if (analyzerRef.current) {
        analyzerRef.current.disconnect();
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      
      analyzerRef.current = analyser;
      drawVisualizer();
    } catch (e) {
      console.error("Visualizer setup failed:", e);
    }
  };

  const drawVisualizer = () => {
    if (!canvasRef.current || !analyzerRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const analyser = analyzerRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      analyser.getByteFrequencyData(dataArray);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;
      
      for(let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        
        ctx.fillStyle = `rgb(99, 102, 241, ${barHeight / 128})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    };
    
    draw();
  };

  const stopVisualizer = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    if (canvasRef.current) {
       const ctx = canvasRef.current.getContext('2d');
       if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  // Handle audio volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Start capturing media and streaming
  const startStreaming = async (type: "system" | "mic") => {
    try {
      if (!navigator.mediaDevices) {
        throw new Error("Media capture is not supported in this environment.");
      }

      let stream: MediaStream;
      if (type === "system") {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("No audio track found.");
      }

      const audioOnlyStream = new MediaStream([audioTrack]);
      localStreamRef.current = audioOnlyStream;
      setupVisualizer(audioOnlyStream);
      setIsStreaming(true);
      setError(null);

      // If we aren't a host yet, become one!
      if (!peerRef.current || !isHost) {
        initializePeer(true);
      } else {
        // We already have listeners waiting, call them!
        dataConnectionsRef.current.forEach((conn, peerId) => {
           const call = peerRef.current!.call(peerId, localStreamRef.current!);
           connectionsRef.current.set(peerId, call);
        });
      }

      audioTrack.onended = () => {
        stopStreaming();
      };
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to capture audio.");
    }
  };

  const stopStreaming = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setIsStreaming(false);
    stopVisualizer();

    // Close all active calls
    connectionsRef.current.forEach((call) => call.close());
    connectionsRef.current.clear();
  };

  const joinRoom = () => {
    if (!roomIdToJoin) return;
    setIsListening(true);
    setActiveRoomId(roomIdToJoin);
    
    // Initialize listener peer
    if (!peerRef.current) {
       initializePeer(false);
    }
    
    // Connect to host so they know we are here
    // We wait for our peer to be open first
    const connectToHost = () => {
       if (!peerRef.current) return;
       const conn = peerRef.current.connect(roomIdToJoin);
       conn.on('error', (err) => console.error("Data connection error", err));
    };
    
    if (peerRef.current?.open) {
      connectToHost();
    } else if (peerRef.current) {
      peerRef.current.on('open', connectToHost);
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${peerId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dismissError = () => setError(null);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 font-sans p-6 selection:bg-indigo-500/30" onClick={() => {
      // interaction to unlock audio context
      if (audioRef.current && isListening && audioRef.current.srcObject) {
         audioRef.current.play().catch(()=>{});
      }
    }}>
      <audio ref={audioRef} autoPlay />

      <div className="max-w-2xl mx-auto space-y-8 mt-10">
        <header className="flex items-center justify-between border-b border-neutral-800 pb-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-500/20 rounded-xl text-indigo-400">
              <Radio className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-medium tracking-tight">Realtime Audio Sync</h1>
              <div className="flex items-center space-x-2 text-sm text-neutral-400 mt-0.5">
                <span className="flex items-center">
                  <div className={`w-2 h-2 rounded-full mr-1.5 ${peerRef.current ? "bg-emerald-500" : "bg-neutral-600"}`}></div>
                  {activeRoomId ? `Room: ${activeRoomId}` : "Offline"}
                </span>
                {isHost && (
                  <>
                    <span>•</span>
                    <span className="flex items-center text-indigo-300">
                      <Crown className="w-3.5 h-3.5 mr-1" />
                      Broadcasting ({listenerCount} listener{listenerCount !== 1 ? 's' : ''})
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl flex items-center justify-between">
            <div className="flex items-center">
              <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
            <button onClick={dismissError} className="text-xs uppercase tracking-wider font-medium hover:text-red-300 ml-4">
              Dismiss
            </button>
          </div>
        )}

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          {(isStreaming || isListening) && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
              <div className="w-64 h-64 bg-indigo-500 rounded-full blur-3xl animate-pulse"></div>
            </div>
          )}

          <div className="relative z-10 flex flex-col items-center text-center space-y-8">
            <canvas 
               ref={canvasRef} 
               width={300} 
               height={100} 
               className="w-full max-w-sm h-24 rounded-lg mix-blend-screen opacity-80" 
             />

            <div className="space-y-2">
              <h2 className="text-2xl font-medium text-neutral-100">
                {isHost ? "You are the Broadcaster" : isListening ? "Listening to Stream" : "Join or Start a Stream"}
              </h2>
              <p className="text-neutral-400 text-sm max-w-sm mx-auto">
                {isHost
                  ? "Your audio is streaming. Share the link below for others to listen."
                  : "Listen to a host's audio seamlessly across any device."}
              </p>
            </div>

            {/* Link Sharing for Host */}
            {isHost && peerId && (
               <div className="w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-xl p-2 flex items-center">
                 <div className="flex-1 truncate px-3 text-sm text-neutral-400 font-mono">
                    {`${window.location.origin}${window.location.pathname}?room=${peerId}`}
                 </div>
                 <button 
                   onClick={copyLink}
                   className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors flex-shrink-0"
                 >
                   {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                 </button>
               </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
              {isHost ? (
                <button
                  onClick={stopStreaming}
                  className="flex items-center px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-xl transition-all"
                >
                  <Square className="w-4 h-4 mr-2 fill-current" />
                  Stop Broadcasting
                </button>
              ) : (
                <>
                  {!isListening ? (
                    <div className="flex flex-col space-y-4 w-full max-w-xs">
                      
                      {/* Join Existing */}
                      <div className="flex items-center space-x-2">
                         <input 
                           type="text" 
                           placeholder="Room ID" 
                           value={roomIdToJoin}
                           onChange={e => setRoomIdToJoin(e.target.value)}
                           className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                         />
                         <button 
                           onClick={joinRoom}
                           disabled={!roomIdToJoin}
                           className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all font-medium text-sm disabled:opacity-50"
                         >
                           Join
                         </button>
                      </div>

                      <div className="flex items-center justify-center space-x-4 opacity-50">
                        <div className="flex-1 h-px bg-neutral-700"></div>
                        <span className="text-xs font-medium uppercase tracking-wider">OR</span>
                        <div className="flex-1 h-px bg-neutral-700"></div>
                      </div>

                      {/* Create New */}
                      <div className="flex flex-col space-y-2">
                        <button
                          onClick={() => startStreaming("system")}
                          className="flex items-center justify-center px-6 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg border border-neutral-700 transition-colors text-sm"
                        >
                          <MonitorUp className="w-4 h-4 mr-2 text-indigo-400" />
                          Share System Audio
                        </button>
                        <button
                          onClick={() => startStreaming("mic")}
                          className="flex items-center justify-center px-6 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg border border-neutral-700 transition-colors text-sm"
                        >
                          <Mic className="w-4 h-4 mr-2 text-indigo-400" />
                          Share Microphone
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center space-y-4 w-full sm:w-auto">
                      <div className="flex items-center px-8 py-4 bg-neutral-800 text-emerald-400 border border-neutral-700 rounded-xl font-medium w-full justify-center shadow-inner">
                        <Volume2 className="w-5 h-5 mr-2 animate-pulse" />
                        Receiving Audio...
                      </div>
                      
                      {/* Volume Slider */}
                      <div className="flex items-center w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg">
                        <Volume2 className="w-4 h-4 text-neutral-500 mr-3 flex-shrink-0" />
                        <input 
                          type="range" 
                          min="0" max="1" step="0.01" 
                          value={volume} 
                          onChange={e => setVolume(parseFloat(e.target.value))} 
                          className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      
                      <button 
                        onClick={() => {
                          setIsListening(false);
                          if (audioRef.current) audioRef.current.srcObject = null;
                          if (peerRef.current) {
                             peerRef.current.destroy(); // fully destroy and re-create if needed later
                             peerRef.current = null;
                          }
                          stopVisualizer();
                          setActiveRoomId(null);
                        }}
                        className="text-sm text-neutral-400 hover:text-white transition-colors py-2"
                      >
                        Leave Room
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-5 text-sm text-neutral-400 leading-relaxed">
          <p className="mb-2">
            <strong className="text-neutral-300 font-medium">How to use (100% Client-Side):</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-1">
            <li>On your Host device, click <strong className="text-neutral-300">Share System Audio</strong>.</li>
            <li>Copy the generated Room Link.</li>
            <li>Open the link on your phone or other device.</li>
            <li>Audio will stream directly via WebRTC using PeerJS signaling! This works perfectly on serverless hosts like Vercel.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

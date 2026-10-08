export interface GlossToken {
  word: string;
  gloss: string;
  non_manual?: string[];
}

export interface WsSessionConfig {
  fps: number;
  variant: string;
  style: string;
  backend: string;
}

export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WsHandlers {
  onStatusChange?: (status: WsStatus, message?: string) => void;
  onSessionReady?: (config: WsSessionConfig) => void;
  onTranscript?: (text: string) => void;
  onGloss?: (tokens: GlossToken[]) => void;
  onSequenceStart?: (meta: { format: string; fps: number; backend: string; num_points: number }) => void;
  onFrames?: (frames: number[][][], isFinal: boolean) => void;
  onSequenceEnd?: (duration: number) => void;
  onError?: (err: string) => void;
}

export class MotionWebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: WsHandlers = {};
  private autoReconnect = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentStatus: WsStatus = "disconnected";

  constructor(handlers: WsHandlers = {}) {
    this.handlers = handlers;
  }

  setHandlers(handlers: WsHandlers) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  connect(customUrl?: string) {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let url = customUrl;
    if (!url) {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      // In dev, connect to 8000 directly or via proxy
      const host = window.location.port === "3000" ? "127.0.0.1:8000" : window.location.host;
      url = `${proto}//${host}/ws/generate`;
    }

    this.setStatus("connecting", "Connecting to motion pipeline…");

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.setStatus("connected", "Ready");
      };

      this.ws.onclose = () => {
        this.setStatus("disconnected", "Disconnected from motion pipeline");
        if (this.autoReconnect) {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.connect(url), 2000);
        }
      };

      this.ws.onerror = (e) => {
        this.setStatus("error", "WebSocket connection error");
        this.handlers.onError?.("WebSocket connection failed");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };
    } catch (err) {
      this.setStatus("error", String(err));
    }
  }

  disconnect() {
    this.autoReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  sendConfig(variant: string, style: string, styleSeed?: number, backend?: string) {
    this.sendJson({
      type: "config",
      variant,
      style,
      backend,
      style_seed: styleSeed,
    });
  }

  sendText(text: string) {
    this.sendJson({
      type: "text",
      text,
    });
  }

  sendAudio(audioBytes: ArrayBuffer | Blob) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioBytes);
    }
  }

  private sendJson(payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setStatus(status: WsStatus, message?: string) {
    this.currentStatus = status;
    this.handlers.onStatusChange?.(status, message);
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case "session_ready":
        this.handlers.onSessionReady?.(msg.config);
        break;
      case "transcript":
        this.handlers.onTranscript?.(msg.text);
        break;
      case "gloss":
        this.handlers.onGloss?.(msg.tokens || []);
        break;
      case "sequence_start":
        this.handlers.onSequenceStart?.(msg);
        break;
      case "frames":
        this.handlers.onFrames?.(msg.frames, msg.final);
        break;
      case "sequence_end":
        this.handlers.onSequenceEnd?.(msg.duration);
        break;
      case "error":
        this.handlers.onError?.(msg.message);
        break;
    }
  }
}

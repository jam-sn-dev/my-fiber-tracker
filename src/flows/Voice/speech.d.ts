/**
 * Minimal ambient declarations for the Web Speech API's SpeechRecognition.
 *
 * TypeScript's lib.dom ships the surrounding types (SpeechRecognitionEvent,
 * SpeechRecognitionErrorEvent, SpeechRecognitionResult[List], the error-code
 * union) but NOT the SpeechRecognition interface itself, nor the window
 * constructors — so only those are declared here, scoped to what the voice
 * flow actually uses.
 */

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
}

interface SpeechRecognitionConstructor {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
}

interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

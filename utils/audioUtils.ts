
export function encodeAudio(bytes: Uint8Array): string {
  const chunkSize = 0x8000; // 32k chunks to avoid stack overflow
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    // @ts-ignore - apply accepts strictly typed arrays but works with Uint8Array in modern browsers
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function decodeAudio(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function downsampleTo16k(buffer: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) return buffer;
  
  const ratio = inputRate / 16000;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const originalIndex = i * ratio;
    const index1 = Math.floor(originalIndex);
    const index2 = Math.min(Math.ceil(originalIndex), buffer.length - 1);
    const weight = originalIndex - index1;
    
    // Linear interpolation
    result[i] = buffer[index1] * (1 - weight) + buffer[index2] * weight;
  }
  return result;
}

export function createPcmBlob(data: Float32Array): { data: string; mimeType: string } {
  // Assuming input data is already at 16000Hz (handled by downsampleTo16k if needed)
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values to prevent distortion
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: encodeAudio(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

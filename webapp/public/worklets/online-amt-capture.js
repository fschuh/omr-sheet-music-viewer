class OnlineAmtCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(512);
    this.chunkOffset = 0;
    this.paused = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "pause") {
        this.paused = true;
        this.chunkOffset = 0;
      } else if (data?.type === "resume") {
        this.paused = false;
        this.chunkOffset = 0;
      } else if (data?.type === "flush") {
        this.chunkOffset = 0;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    for (const channel of output ?? []) channel.fill(0);
    if (this.paused) return true;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frameCount = channels[0].length;
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] ?? 0;
      this.chunk[this.chunkOffset] = sample / channels.length;
      this.chunkOffset += 1;
      if (this.chunkOffset === this.chunk.length) {
        const audio = this.chunk;
        this.port.postMessage(
          {
            type: "audio",
            audio: audio.buffer,
            audioTimeMs: (currentFrame + frame + 1) * 1000 / sampleRate,
          },
          [audio.buffer],
        );
        this.chunk = new Float32Array(512);
        this.chunkOffset = 0;
      }
    }
    return true;
  }
}

registerProcessor("online-amt-capture", OnlineAmtCaptureProcessor);

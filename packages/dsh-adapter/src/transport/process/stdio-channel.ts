import type { Readable, Writable } from 'node:stream';

export class StdioChannel {
  private buffer = '';

  constructor(
    readonly stdin: Writable,
    readonly stdout: Readable,
    readonly stderr: Readable,
  ) {}

  send(message: unknown): void {
    this.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(handler: (message: never) => void): void {
    this.stdout.setEncoding('utf8');
    this.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;

      while (true) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) {
          return;
        }

        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);

        if (!line) {
          continue;
        }

        handler(JSON.parse(line) as never);
      }
    });
  }
}

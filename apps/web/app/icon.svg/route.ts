export function GET() {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="96" fill="#fffdf8"/>
      <path d="M144 278c0-72 48-122 112-122s112 50 112 122c0 52-32 88-83 88h-58c-51 0-83-36-83-88Z" fill="#315f86"/>
      <path d="M196 256h120M210 310h92" stroke="#fffdf8" stroke-width="30" stroke-linecap="round"/>
      <circle cx="211" cy="219" r="18" fill="#f2c46d"/>
      <circle cx="301" cy="219" r="18" fill="#f2c46d"/>
    </svg>`,
    {
      headers: {
        "content-type": "image/svg+xml",
      },
    },
  );
}

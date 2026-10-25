import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock Journal AI",
  description: "Private multi-user investment journal",
  robots: { index: false, follow: false, nocache: true },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body style={{fontFamily:"system-ui,sans-serif",margin:"3rem auto",maxWidth:760,padding:"0 1rem",lineHeight:1.6}}>
        {children}
      </body>
    </html>
  );
}

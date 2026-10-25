import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Positionary | 나만의 투자 판단 기록", template: "%s | Positionary" },
  description: "매매의 사실과 투자 판단을 구분해 기록하는 개인 투자 저널. Google 계정으로 시작하고, Tiger 연동은 공식 승인 후 제공됩니다.",
  applicationName: "Positionary",
  robots: { index: false, follow: false, nocache: true },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}

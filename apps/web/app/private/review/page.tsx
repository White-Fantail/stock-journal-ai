import Link from "next/link";
import type {Metadata} from "next";
export const metadata:Metadata={title:"투자 점검 · Positionary"};
export default function ReviewHub(){
  return <main className="journal-page">
    <div className="page-intro"><h1>투자 점검</h1>
      <p>내가 세운 투자 원칙과 지난 판단을 확인하고 다음 행동을 정리합니다. 가격 알림이나 자동 주문은 제공하지 않습니다.</p>
    </div>
    <div className="review-entry-grid">
      <section className="user-panel"><h2>지금 점검할 일</h2>
        <p>내 기록을 바탕으로 점검 시점이 된 종목과 빠진 계획을 확인합니다.</p>
        <Link className="btn btn-primary" href="/private/alerts">점검할 일 보기 →</Link>
      </section>
      <section className="user-panel"><h2>주간 투자 점검</h2>
        <p>이번 주에 투자 계획을 점검했고 그때 어떤 판단을 했는지 돌아봅니다.</p>
        <Link className="btn btn-outline" href="/private/reports/weekly">주간 점검 →</Link>
      </section>
      <section className="user-panel"><h2>월간 복기</h2>
        <p>계획 변경과 내가 기록한 투자 원칙 자기평가를 한 달 단위로 살펴봅니다.</p>
        <Link className="btn btn-outline" href="/private/reports/monthly">월간 복기 →</Link>
      </section>
      <section className="user-panel"><h2>AI로 되돌아보기</h2>
        <p>선택한 기록 일부에 대한 전송 동의를 받은 뒤 반복되는 판단 습관을 살펴봅니다.</p>
        <Link className="btn btn-outline" href="/private/analysis?mode=COACHING">AI 코칭 →</Link>
      </section>
    </div>
  </main>;
}

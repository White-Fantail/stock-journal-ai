import Link from "next/link";
import {redirect} from "next/navigation";
import {currentWorkspace} from "../../../lib/require-workspace";
import {RiskCalculator} from "./risk-calculator";
export const dynamic="force-dynamic";
export const metadata={title:"투자 위험 예산 계산기 · Positionary"};
export default async function RiskPage(){
 if(!await currentWorkspace())redirect("/login");
 return <main className="journal-page">
   <div className="page-intro">
     <span className="breadcrumb"><Link href="/private/portfolio">← 포트폴리오</Link></span>
     <h1>투자 위험 예산 계산기</h1>
     <p>주가 감시 없이 사전에 감수할 손실과 투자 규모를 비교합니다. 장기 보유를 위한 비중 관리와는 별도의 참고 계산입니다.</p>
   </div>
   <RiskCalculator/>
 </main>;
}

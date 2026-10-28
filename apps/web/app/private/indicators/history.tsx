import {fetchIndicatorRecords} from "../../../lib/saas-trades-api";
import type {IndicatorFilter} from "../../../lib/indicators";
import {IndicatorRecordList} from "./record-list";
export async function IndicatorHistory({subject,filter}:{subject:string;filter:IndicatorFilter}){
 const result=await fetchIndicatorRecords(subject,filter).catch(()=>null);
 if(!result)return <p role="alert">보조지표 기록을 불러올 수 없습니다.</p>;
 return <IndicatorRecordList records={result.records} hasMore={result.hasMore}/>;
}

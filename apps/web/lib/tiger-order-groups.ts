/** Exact order-to-fill read projection; never infer parentage from ticker, price or time.
 * Legacy observations without a parent link stay visible as unlinked fills.
 * Observations are not a certified complete execution ledger.
 */
import type { TigerPersonalFill, TigerPersonalOrder } from "./tiger-api";

export type GroupedTigerOrder = Readonly<{
  order: TigerPersonalOrder;
  fills: readonly TigerPersonalFill[];
  reconciliation: "NOT_OBSERVED"|"QUANTITY_UNKNOWN"|"OBSERVED_SUM_MATCH"|"PARTIAL_OR_DIFFERENT";
}>;

function decimalUnits(value:string):bigint {
  const [whole, fraction=""]=value.split(".");
  return BigInt(whole)*BigInt("1000000000000")+
    BigInt(fraction.padEnd(12,"0"));
}

export function groupTigerOrderObservations(
  orders:readonly TigerPersonalOrder[],
  fills:readonly TigerPersonalFill[],
):{orders:GroupedTigerOrder[];unlinked: TigerPersonalFill[]}{
  const byRef=new Map(orders.map(order=>[order.sourceRef,order]));
  const matched=new Map<string,TigerPersonalFill[]>();
  const unlinked:TigerPersonalFill[]=[];
  const seen=new Set<string>();
  for(const fill of fills){
    // Duplicate probe snapshots must never double-count a transaction.
    if(seen.has(fill.sourceRef)) continue;
    seen.add(fill.sourceRef);
    const parent=fill.orderSourceRef ? byRef.get(fill.orderSourceRef) : undefined;
    if(!parent || parent.symbol!==fill.symbol || parent.side!==fill.side ||
       parent.currency!==fill.currency){
      unlinked.push(fill);
      continue;
    }
    const list=matched.get(parent.sourceRef)??[];
    list.push(fill);
    matched.set(parent.sourceRef,list);
  }
  return {orders:orders.map(order=>{
    const observed=matched.get(order.sourceRef)??[];
    const reconciliation=observed.length===0?"NOT_OBSERVED":
      order.filled===null?"QUANTITY_UNKNOWN":
      observed.reduce((sum,fill)=>sum+decimalUnits(fill.quantity),BigInt(0))===
        decimalUnits(order.filled)?"OBSERVED_SUM_MATCH":"PARTIAL_OR_DIFFERENT";
    return {order,fills:observed,reconciliation};
  }),unlinked};
}

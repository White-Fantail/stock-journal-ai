/** Real Next.js pages, real localhost HMAC API + disposable PostgreSQL.
 * Only Auth.js Google CALLBACK is substituted with synthetic local JWTs.
 * This is not a live Google OAuth, Tiger, production, or real-device test.
 */
import {test,expect} from "@playwright/test";
import {encode} from "next-auth/jwt";
const ORIGIN="http://127.0.0.1:3100";
const A="9000000000000000041",B="9000000000000000042";
const synthetic=true;
async function signedContext(browser,sub){
 if(!process.env.POSITIONARY_BROWSER_CI||process.env.SAAS_TEST_DB_ACK!=="YES_DISPOSABLE_SAAS_DB")
  throw Error("Synthetic browser sessions forbidden outside disposable CI");
 const ctx=await browser.newContext({baseURL:ORIGIN,viewport:{width:375,height:812}});
 const jwt=await encode({secret:process.env.AUTH_SECRET,salt:"authjs.session-token",
  maxAge:1800,token:{sub,googleSubject:sub,email:sub+"@example.invalid",name:"Synthetic"}});
 await ctx.addCookies([{name:"authjs.session-token",value:jwt,url:ORIGIN,httpOnly:true,sameSite:"Lax"}]);
 return ctx;
}
const mark="Synthetic assessment: review primary-source business assumptions.";
test("unauthed browser redirects private workflows and cannot export data",async({page,request})=>{
 for(const path of ["/private","/private/portfolio","/private/journal",
   "/private/journal/new?mode=plan&ticker=QATEST","/private/review",
   "/private/review/action/new?checkin=00000000-0000-4000-8000-000000000001",
   "/private/indicators","/private/indicators/edit","/private/indicators/record",
   "/private/principles","/private/analysis","/private/settings"]){
  await page.goto(path);
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
 }
 const res=await request.get("/api/private/journal/export");
 expect(res.status()).toBe(401);
 expect(res.headers()["cache-control"]??"").toContain("no-store");
});
test("A completes full authored journey; B is isolated; deletion invalidates A session",async({browser})=>{
 const a=await signedContext(browser,A),b=await signedContext(browser,B);
 try{
  const page=await a.newPage();
  // Record request path+status only, never session cookies or authored inputs.
  page.on("response",r=>{if(r.request().method()==="POST"){
   const u=new URL(r.url());console.log("SYNTHETIC_POST",u.pathname,r.status());
  }});
  page.on("pageerror",e=>console.log("SYNTHETIC_PAGE_ERROR",e.name));
  await page.goto("/private/getting-started");
  await expect(page.getByRole("heading",{name:/투자 기록 시작하기/}).first()).toBeVisible();
  await page.goto("/private/principles",{waitUntil:"networkidle"});
  await expect(page.locator("[data-private-hydrated]")).toBeAttached();
  await expect(page.getByRole("heading",{name:"나의 투자 원칙",exact:true})).toBeVisible();
  await page.locator('select[name="objective"]').selectOption("LEARNING");
  await page.locator('textarea[name="note"]').fill("Synthetic B7 principles in workspace A only.");
  await page.getByRole("button",{name:"나의 원칙 저장"}).click();
  await expect(page).toHaveURL(/\/private\/principles\?saved=1/).catch(async e=>{
   const status=await page.locator('[role="alert"],[role="status"]').allTextContents();
   const actions=await page.locator("form").evaluateAll(fs=>fs.map(f=>({method:f.method,action:new URL(f.action).pathname})));
   throw Error("Principles submit did not finish: "+JSON.stringify({url:page.url(),status,actions})+"; "+String(e).slice(0,350));
  });
  await page.goto("/private/journal/new?mode=plan&ticker=QATEST");
  await expect(page.locator("[data-private-hydrated]")).toBeAttached();
  await expect(page.locator('input[name="ticker"]')).toHaveValue("QATEST");
  await page.locator('textarea[name="rationale"]').fill("Synthetic B7 initial investment rationale");
  // Synthetic manual source: unknown Tiger holdings are not silently zero.
  await page.locator('select[name="strategyType"]').selectOption("LONG_TERM");
  await page.locator('input[name="maxAllocationPct"]').fill("20");
  await page.getByLabel(/투자 기준 자산 총액/).fill("10000");
  await page.getByLabel(/매수에 사용할 수 있는 현금/).fill("5000");
  await page.getByLabel(/기존 QATEST 평가액/).fill("0");
  await page.getByLabel(/기존 QATEST 보유 수량/).fill("0");
  await page.getByLabel(/가정할 매수가/).fill("400");
  await page.getByLabel(/추가 매수를 가정할 수량/).fill("2");
  await expect(page.locator(".plan-scenario-result")).toContainText("0% → 8%");
  await expect(page.locator('input[name="riskDecisionNote"]')).toHaveValue("");
  await page.locator(".plan-risk-decision input[type=checkbox]").check();
  await expect(page.locator('input[name="riskDecisionNote"]')).toHaveValue(/QATEST.*8.00%/);

  await page.locator('textarea[name="invalidationCondition"]').fill("Synthetic thesis invalidated when assumptions change");
  await page.locator('select[name="reviewCadence"]').selectOption("MONTHLY");
  await page.getByRole("button",{name:"새 투자 계획 저장"}).click();
  await expect(page).toHaveURL(/\/private\/journal\?saved=plan&ticker=QATEST/);
  await expect(page.locator(".journal-current")).toContainText("QATEST");
  await expect(page.locator(".journal-guided-workflow")).toContainText("투자 논리 기록됨");
  await page.goto("/private/journal/new?mode=plan&ticker=QATEST");
  await expect(page.locator("[data-private-hydrated]")).toBeAttached();
  await expect(page.locator('textarea[name="invalidationCondition"]')).toHaveValue("Synthetic thesis invalidated when assumptions change");
  await expect(page.locator('select[name="reviewCadence"]')).toHaveValue("MONTHLY");
  await page.locator('textarea[name="rationale"]').fill("Synthetic B7 revised investment reasoning");
  await page.getByRole("button",{name:"새 투자 계획 저장"}).click();
  await expect(page).toHaveURL(/\/private\/journal\?saved=plan&ticker=QATEST/);
  await page.goto("/private/journal/review/new?ticker=QATEST");
  await expect(page.locator("[data-private-hydrated]")).toBeAttached();
  await expect(page.getByRole("heading",{name:"투자 원칙 자기평가"})).toBeVisible();
  await page.locator('select[name="selfAssessment"]').selectOption("PARTIAL");
  await page.locator('textarea[name="content"]').fill("Synthetic B7 review of my recorded reasoning.");
  await page.locator('textarea[name="nextAction"]').fill(mark);
  await page.getByRole("button",{name:"원칙 자기평가 저장"}).click();
  await expect(page).toHaveURL(/\/private\/journal\?ticker=QATEST&saved=checkin/);
  await page.goto("/private");
  await expect(page.locator(".next-review-panel")).toContainText("QATEST");
  await page.goto("/private/review");
  await expect(page.locator(".review-action-item").filter({hasText:"QATEST"})).toContainText(mark);
  await page.locator(".review-action-item").filter({hasText:"QATEST"}).getByRole("link",{name:/실행 여부 기록/}).click();
  await expect(page.locator("[data-private-hydrated]")).toBeAttached();
  await page.locator('select[name="state"]').selectOption("DONE");
  await page.locator('textarea[name="note"]').fill("Synthetic self-reported review, not independently verified");
  await page.getByRole("button",{name:"내 확인 결과 저장"}).click();
  await expect(page).toHaveURL(/\/private\/review\?saved=action/);
  await expect(page.locator(".review-action-item").filter({hasText:"QATEST"})).toContainText("완료했다고 기록");
  // Register two timeframe criteria, then attach manually entered values to a trade.
  for(const [timeframe,operator,lower,condition] of [["일봉","LTE","30",""],["15분봉","MANUAL","","30 상향 돌파"]]){
    await page.goto("/private/indicators/edit",{waitUntil:"networkidle"});
    await page.getByLabel("지표 이름",{exact:true}).fill("RSI");
    await page.getByLabel("설정값 (선택)",{exact:true}).fill("14");
    await page.getByLabel("시간봉",{exact:true}).fill(timeframe);
    await page.locator('select[name="operator"]').selectOption(operator);
    if(lower)await page.locator('input[name="lower"]').fill(lower);
    else {
      await page.locator('select[name="stage"]').selectOption("TIMING");
      await page.locator('textarea[name="condition"]').fill(condition);
    }
    await page.getByRole("button",{name:"지표 기준 저장"}).click();
    await expect(page).toHaveURL(/indicators\?saved=rule/);
  }
  await page.goto("/private/trades/new",{waitUntil:"networkidle"});
  await page.locator('input[name="ticker"]').fill("QATEST");
  await page.locator('input[name="quantity"]').fill("1");
  await page.locator('input[name="price"]').fill("100");
  await page.locator('input[name="executedAt"]').fill("2026-10-20T14:30:00+13:00");
  await page.locator('input[name="confirm"]').check();
  await page.locator('input[name="recordIndicators"]').check();
  await page.getByRole("button",{name:"거래 기록 저장"}).click();
  await expect(page).toHaveURL(/indicators\/record\?savedTrade=1&tradeEventId=/);
  const daily=page.locator("fieldset").filter({hasText:"일봉"});
  const intraday=page.locator("fieldset").filter({hasText:"15분봉"});
  await daily.locator('input[type="checkbox"]').check();
  await daily.locator('input[inputmode="decimal"]').fill("31");
  await intraday.locator('input[type="checkbox"]').check();
  await intraday.locator('input[inputmode="decimal"]').fill("32");
  await intraday.locator("select").selectOption("MET");
  await page.locator('textarea[name="note"]').fill("Synthetic manual indicator decision");
  await page.locator('input[name="observedAt"]').fill("2026-10-20T14:30:00");
  await page.getByRole("button",{name:"당시 지표 기록 저장"}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(daily.locator('input[inputmode="decimal"]')).toHaveValue("31");
  await expect(page.locator('textarea[name="note"]')).toHaveValue("Synthetic manual indicator decision");
  await expect(daily.locator('input[type="checkbox"]')).toBeChecked();
  await expect(intraday.locator('input[type="checkbox"]')).toBeChecked();
  await expect(page.locator('input[name="revisionId"]')).toHaveCount(2);
  await page.locator('input[name="observedAt"]').fill("2026-10-20T14:30:00+13:00");
  await page.getByRole("button",{name:"당시 지표 기록 저장"}).click();
  await expect(page).toHaveURL(/indicators\?saved=record&ticker=QATEST/);
  await expect(page.locator(".indicator-history")).toContainText("30 이하");
  await expect(page.locator(".indicator-history")).toContainText("미충족");
  await expect(page.locator(".indicator-history")).toContainText("직접 판단");
  await page.locator(".indicator-rule-list article").filter({hasText:"일봉"}).getByRole("link").click();
  await page.locator('input[name="lower"]').fill("35");
  await page.getByRole("button",{name:"지표 기준 저장"}).click();
  await expect(page).toHaveURL(/indicators\?saved=rule/);
  await expect(page.locator(".indicator-rule-list")).toContainText("35 이하");
  await expect(page.locator(".indicator-history")).toContainText("30 이하");
  await page.locator(".indicator-history").getByRole("link",{name:/연결된 거래/}).click();
  await expect(page.locator(".indicator-history")).toContainText("Synthetic manual indicator decision");
  await page.goto("/private/journal?ticker=QATEST");
  await page.getByText("QATEST 보조지표 기록 보기",{exact:true}).click();
  await expect(page.locator(".indicator-history")).toContainText("Synthetic manual indicator decision");
  const exp=await a.request.get(ORIGIN+"/api/private/journal/export");
  expect(exp.status()).toBe(200);
  expect(exp.headers()["cache-control"]).toContain("no-store");
  const exported=await exp.json();
  expect(exported.complete).toBe(true);
  expect(exported.indicatorRules).toHaveLength(3);
  expect(exported.indicatorRecords).toHaveLength(1);
  expect(exported.indicatorRecords[0].observations.find(o=>o.rule.timeframe==="일봉").rule.lower).toBe("30");
  expect(exported.plans.filter(p=>p.ticker==="QATEST").length).toBe(2);
  expect(exported.plans.filter(p=>p.ticker==="QATEST").some(p=>
    typeof p.riskDecisionNote==="string"&&p.riskDecisionNote.includes("8.00%"))).toBe(true);
  expect(exported.planSelfReviews.some(p=>p.ticker==="QATEST")).toBe(true);
  const action=exported.actionFollowups.find(x=>x.state==="DONE");
  expect(action).toBeTruthy();
  expect(exported.investorPrinciples.some(p=>p.note==="Synthetic B7 principles in workspace A only.")).toBe(true);
  const bpage=await b.newPage();
  await bpage.goto("/private/journal");
  await expect(bpage.getByRole("heading",{name:"투자 일지"})).toBeVisible();
  await expect(bpage.locator("body")).not.toContainText("Synthetic B7 revised investment reasoning");
  await bpage.goto("/private/review");
  await expect(bpage.locator("body")).not.toContainText(mark);
  await bpage.goto("/private/review/action/new?checkin="+encodeURIComponent(action.checkinId));
  await expect(bpage.getByRole("heading",{name:"선택한 행동을 확인할 수 없습니다"})).toBeVisible();
  await bpage.goto("/private/indicators");
  await expect(bpage.locator("body")).not.toContainText("Synthetic manual indicator decision");
  const bExport=await b.request.get(ORIGIN+"/api/private/journal/export");
  expect(bExport.status()).toBe(200);
  const bData=await bExport.json();
  expect(bData.indicatorRules).toHaveLength(0);
  expect(bData.indicatorRecords).toHaveLength(0);
  expect(bData.plans).toHaveLength(0);
  expect(bData.planSelfReviews).toHaveLength(0);
  expect(bData.actionFollowups).toHaveLength(0);
  await page.goto("/private/settings");
  await expect(page.locator("[data-private-hydrated]")).toBeAttached();
  await page.locator('input[name="confirm"]').fill("DELETE_MY_ACCOUNT");
  await page.getByRole("button",{name:"내 계정과 데이터 영구 삭제"}).click();
  await expect(page).toHaveURL(/\/login\?deleted=1/);
  await page.goto("/private/journal");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await bpage.goto("/private/journal");
  await expect(bpage.getByRole("heading",{name:"투자 일지"})).toBeVisible();
 }finally{await a.close();await b.close();}
});
test("private primary and More menus keep navigating through full documents",async({browser})=>{
 const ctx=await signedContext(browser,B);
 try{
  const page=await ctx.newPage();
  await page.setViewportSize({width:1280,height:820});
  await page.goto("/private/principles");
  for(const [href,inMore] of [
   ["/private/trades",true],["/private/portfolio",false],
   ["/private/analysis",true],["/private/review",false],
   ["/private/settings",true],["/private",false],
  ]){
   const menu=page.locator(".app-nav");
   if(inMore)await menu.locator(".app-desktop-more summary").click();
   const navigation=page.waitForRequest(r=>r.isNavigationRequest() &&
     new URL(r.url()).pathname===href);
   await menu.locator('a[href="'+href+'"]').click();
   const request=await navigation;
   expect(request.resourceType()).toBe("document");
   await expect(page).toHaveURL(new RegExp(href.replaceAll("/","\\/")+"$"));
   await expect(page.locator("main").first()).toBeVisible();
  }
  await page.setViewportSize({width:375,height:780});
  await page.goto("/private/principles");
  const details=page.locator(".app-mobile-more");
  await details.locator("summary").click();
  const navigation=page.waitForRequest(r=>r.isNavigationRequest()&&
   new URL(r.url()).pathname==="/private/settings");
  await details.locator('a[href="/private/settings"]').click();
  expect((await navigation).resourceType()).toBe("document");
  await expect(page).toHaveURL(/\/private\/settings$/);
 }finally{await ctx.close();}
});
test("responsive real pages: 320–1024, touch menu, keyboard and overflow",async({browser})=>{
 const ctx=await signedContext(browser,B);
 try{
  const page=await ctx.newPage();
  for(const width of [320,375,430,768,1024]){
   await page.setViewportSize({width,height:780});
   for(const route of ["/private","/private/journal","/private/indicators","/private/indicators/edit","/private/indicators/record",
     "/private/journal/new?mode=plan&ticker=BRTEST","/private/review",
     ...(width===375?["/private/portfolio","/private/principles",
      "/private/settings","/private/reports/weekly","/private/reports/monthly",
      "/private/analysis"]:[])]){
    await page.goto(route,{waitUntil:"domcontentloaded"});
    await expect(page.locator("main").first()).toBeVisible();
    const size=await page.evaluate(()=>({
     width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
    }));
    expect.soft(size.width-size.client,route+" at "+width+"px horizontal overflow").toBeLessThanOrEqual(1);
   }
   if(width<=1024){
    const response=await page.goto("/private");
    const details=page.locator(".app-mobile-more");
    if(await details.count()!==1){
      const authProbe=await ctx.request.get(ORIGIN+"/api/auth/session");
      const authData=await authProbe.json().catch(()=>({}));
      const cookieNames=(await ctx.cookies(ORIGIN)).map(c=>c.name);
      throw Error("Mobile menu missing "+JSON.stringify({
        width,status:response?.status(),url:page.url(),
        title:await page.title(),headings:await page.locator("h1").allTextContents(),
        authStatus:authProbe.status(),sessionHasSubject:Boolean(authData?.user?.id),
        hasSessionCookie:cookieNames.some(n=>n.includes("session-token"))
      }));
    }
    await details.locator("summary").click({timeout:12000});
    await expect(details.getByRole("link",{name:"설정"})).toBeVisible();
    const rect=await details.locator("summary").boundingBox();
    expect(rect?.height??0).toBeGreaterThanOrEqual(40);
    await details.getByRole("link",{name:"설정"}).click();
    await expect(page).toHaveURL(/\/private\/settings/);
   }
  }
  await page.setViewportSize({width:375,height:780});
  await page.goto("/private/principles");
  await page.keyboard.press("Tab");
  const focus=await page.evaluate(()=>document.activeElement?.tagName);
  expect(["A","BUTTON","SUMMARY","INPUT","SELECT"]).toContain(focus);
 }finally{await ctx.close();}
});

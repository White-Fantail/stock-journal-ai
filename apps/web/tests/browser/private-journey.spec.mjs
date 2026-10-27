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
  const exp=await a.request.get(ORIGIN+"/api/private/journal/export");
  expect(exp.status()).toBe(200);
  expect(exp.headers()["cache-control"]).toContain("no-store");
  const exported=await exp.json();
  expect(exported.complete).toBe(true);
  expect(exported.plans.filter(p=>p.ticker==="QATEST").length).toBe(2);
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
  const bExport=await b.request.get(ORIGIN+"/api/private/journal/export");
  expect(bExport.status()).toBe(200);
  const bData=await bExport.json();
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
   ["/private/risk",true],["/private/review",false],
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
   for(const route of ["/private","/private/journal",
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

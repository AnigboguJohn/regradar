import requests, json, time, sys
B="http://localhost:4000"; import os
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","..","demo")+"/"
B=os.environ.get("API_URL","http://localhost:4000")
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ")+msg)
    if not cond: ok.fails+=1
ok.fails=0
s=requests.Session(); s.trust_env=False
t=str(int(time.time()))
# auth
r=s.post(B+"/api/auth/register",json={"captcha":"test","orgName":"Demo Bank","name":"Ada Obi","email":f"ada{t}@demobank.ng","password":"weak"})
ok(r.status_code==400 and "10 characters" in r.json()["error"], "weak password rejected")
r=s.post(B+"/api/auth/register",json={"captcha":"test","orgName":"Demo Bank","name":"Ada Obi","email":f"ada{t}@demobank.ng","password":"Str0ngPassw0rd"})
ok(r.status_code==201, "register org admin"); A=r.json()["token"]; H={"authorization":"Bearer "+A}
ok(s.post(B+"/api/auth/login",json={"captcha":"test","email":f"ada{t}@demobank.ng","password":"wrongpassword1"}).status_code==401,"wrong password rejected")
ok(s.post(B+"/api/auth/login",json={"captcha":"test","email":f"ada{t}@demobank.ng","password":"Str0ngPassw0rd"}).status_code==200,"login")
ok(s.get(B+"/api/stats").status_code==401,"unauthenticated blocked")
ok(s.get(B+"/api/me",headers=H).json()["user"]["orgName"]=="Demo Bank","me")
# live sync (CBN may be unreachable from this sandbox)
r=s.post(B+"/api/admin/sync",headers=H,json={}); print("  sync:",r.status_code,json.dumps(r.json())[:300])
ok(r.status_code==200,"sync endpoint completes gracefully")
# uploads
with open(D+"sample_circular.txt","rb") as f:
    r=s.post(B+"/api/regulations/upload",headers=H,files={"file":("sample_circular.txt",f)},data={"title":"Sample Circular: Revised Tiered KYC (demo)","regulator":"DEMO","ref_no":"DEMO/KYC/2026/001","published_at":"2026-10-15"})
ok(r.status_code==201,"upload regulation"); REG=r.json()["id"]
with open(D+"sample_policy.pdf","rb") as f:
    r=s.post(B+"/api/policies",headers=H,files={"file":("sample_policy.pdf",f)},data={"title":"Customer Onboarding & KYC Policy v2.1"})
ok(r.status_code==201,"upload policy PDF"); POL=r.json()["id"]
pol=s.get(B+"/api/policies",headers=H).json()["policies"]; ok(len(pol)==1 and pol[0]["sections"]>=3, f"policy indexed ({pol[0]['sections']} sections)")
with open(D+"sample_circular.txt","rb") as f:
    ok(s.post(B+"/api/policies",headers=H,files={"file":("x.exe",f)}).status_code==422,"unsupported file type rejected")
# ask
r=s.post(B+"/api/ask",headers=H,json={"question":"What is the maximum cumulative balance for Tier 1 accounts?"})
j=r.json(); ok(r.status_code==200 and j["citations"], f"ask returns cited answer (mode={j.get('mode')}, {len(j.get('citations',[]))} citations)")
ok(any("N300,000" in c["excerpt"] for c in j["citations"]),"correct passage cited (N300,000)")
print("  answer:", j["answer"][:400].replace("\n"," | "))
r=s.post(B+"/api/ask",headers=H,json={"question":"How long must records be kept?","scope":"policies"})
ok(all(c["kind"]=="policy" for c in r.json()["citations"]),"scope=policies only cites policies")
ok(len(s.get(B+"/api/ask/history",headers=H).json()["messages"])==2,"chat history saved")
# regulations
regs=s.get(B+"/api/regulations",headers=H).json()["regulations"]; ok(any(x["id"]==REG for x in regs),"regulation in feed")
ok(s.get(B+f"/api/regulations?q=DEMO/KYC",headers=H).json()["regulations"][0]["id"]==REG,"search by ref no")
det=s.get(B+f"/api/regulations/{REG}",headers=H).json(); ok(len(det["chunks"])>=4,"regulation detail with sections")
ok(s.get(B+"/api/regulations/not-a-uuid",headers=H).status_code==400,"bad id -> 400")
# impact
r=s.post(B+"/api/impact/run",headers=H,json={"regulationId":REG}); ok(r.status_code==200 and r.json()["findings"],f"impact analysis ({len(r.json()['findings'])} findings)")
f=s.get(B+"/api/impact",headers=H).json()["findings"]; ok(f and f[0]["policy_title"].startswith("Customer"),"findings listed with policy")
ok(s.patch(B+f"/api/impact/{f[0]['id']}",headers=H,json={"status":"resolved"}).status_code==200,"resolve finding")
ok(len(s.get(B+"/api/impact?status=resolved",headers=H).json()["findings"])==1,"resolved filter")
st=s.get(B+"/api/stats",headers=H).json(); print("  stats:",st)
# alerts/team/audit
ok(s.put(B+"/api/alerts",headers=H,json={"emails":["cco@demobank.ng"],"regulators":["DEMO"],"keywords":["KYC"],"enabled":True}).status_code==200,"save alert settings")
r=s.post(B+"/api/team",headers=H,json={"name":"Bayo","email":f"bayo{t}@demobank.ng","password":"An0therGoodOne","role":"member"}); ok(r.status_code==201,"add team member")
M={"authorization":"Bearer "+s.post(B+"/api/auth/login",json={"captcha":"test","email":f"bayo{t}@demobank.ng","password":"An0therGoodOne"}).json()["token"]}
ok(s.get(B+"/api/audit",headers=M).status_code==403,"member blocked from admin audit")
ok(s.get(B+"/api/regulations",headers=M).status_code==200,"member can read regulations")
ev=s.get(B+"/api/audit",headers=H).json()["events"]; ok(len(ev)>=8,f"audit log ({len(ev)} events)")
# tenant isolation
r=s.post(B+"/api/auth/register",json={"captcha":"test","orgName":"Other Fintech","name":"Eve","email":f"eve{t}@other.io","password":"Str0ngPassw0rd"}); E={"authorization":"Bearer "+r.json()["token"]}
ok(s.get(B+f"/api/regulations/{REG}",headers=E).status_code==404,"other org cannot see private regulation")
ok(s.get(B+"/api/policies",headers=E).json()["policies"]==[],"other org sees no policies")
r=s.post(B+"/api/ask",headers=E,json={"question":"Tier 1 maximum cumulative balance"}); ok(r.json()["citations"]==[],"other org's answers never use Demo Bank data")
ok(s.delete(B+f"/api/policies/{POL}",headers=E).status_code==404,"other org cannot delete policy")
# cron
ok(s.post(B+"/internal/cron/monitor",headers={"x-cron-secret":"nope"}).status_code==401,"cron rejects bad secret")
ok(s.post(B+"/internal/cron/monitor",headers={"x-cron-secret":os.environ.get("CRON_SECRET","dev-cron-secret")}).status_code==202,"cron accepts valid secret")
print("\nFAILURES:", ok.fails); sys.exit(ok.fails)

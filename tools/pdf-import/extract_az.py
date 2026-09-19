import sys, json, collections
import parse_activezone as A
f=sys.argv[1]
r,t=A.parse_file("/mnt/user-data/uploads/dieta/"+f)
s=collections.Counter()
for x in r: s[x["day"]]+=x["kcal"] or 0
json.dump({"file":f,"recipes":r,"day_totals_pdf":t,"day_totals_parsed":s},open("out/"+f+".json","w"),ensure_ascii=False,indent=1)
bad={d:(t.get(d),s[d]) for d in s if t.get(d)!=s[d]}
print(f,len(r),"bad",bad)
for x in r:
  for i in x["ingredients"]:
    if i["amount"] is None: print("  ing?",x["name"],i)
  if not x["name"] or not x["description"]: print("  empty",x["day"],x["source_meal"],x["name"])

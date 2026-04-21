# BIZUSIZO native-speaker review — Setswana

**Language:** Setswana (code: `tn`)
**Generated:** 2026-04-20 (from live source code)
**Reviewer instructions:** For each entry below, please mark ✅ (correct and natural), ❌ (wrong — suggest fix), or ➕ (add missing phrasing). For any ❌ or ➕, please provide the correct/additional phrasing in the notes column.

**What you are reviewing:** all Setswana content that a patient might read (Part 1 — WhatsApp messages) or that the system scans patient text for (Part 2 — clinical safety keywords).

---

## PART 1 — Patient-facing WhatsApp messages (51 entries)

Each row shows the English source text (for reference) and the current Setswana translation. If Setswana is marked **[MISSING — PLEASE TRANSLATE]**, the translation has not been written yet and we need you to provide it.

### 1A. Core messages (lib/messages.js)

### 1.1 `language_menu` *(lib/messages.js)*

**English source:**
```
Welcome to BIZUSIZO 🏥

Choose your language / Khetha ulimi lwakho:

1. English
2. isiZulu
3. isiXhosa
4. Afrikaans
5. Sepedi
6. Setswana
7. Sesotho
8. Xitsonga
9. siSwati
10. Tshivenda
11. isiNdebele

Reply with the number.
```

**Setswana:**
*(Not language-specific — shown in all languages at once.)*

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.2 `language_set` *(lib/messages.js)*

**English source:**
```
✅ Language set to *English*.
Type "language" anytime to change.
```

**Setswana:**
```
✅ Puo e beilwe go *Setswana*.
Kwala "puo" nako nngwe go fetola.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.3 `consent` *(lib/messages.js)*

**English source:**
```
Welcome to BIZUSIZO. 🏥

This service helps you understand the urgency of your symptoms and guides you on where to seek care.

Important:
• This service provides health guidance only.
• It does not diagnose medical conditions.
• It does not replace a doctor or nurse.

We may ask questions about your symptoms to help guide you. Your responses may be securely stored to improve the safety and quality of the service. If you are referred to a clinic or hospital, your health information may be shared with the receiving facility to ensure you get the right care. Your information will be handled according to South African privacy laws (POPIA).

Do you consent to using this service?

1 — Yes, I consent and want to continue
2 — No, exit
```

**Setswana:**
```
O amogelwa go BIZUSIZO. 🏥

Tirelo eno e go thusa go tlhaloganya go tshoganyetsa ga matshwenyego a gago mme e go kaele gore o batla thuso kae.

Go botlhokwa:
• Tirelo eno e fa tataiso ya boitekanelo fela.
• Ga e hlahlobe maemo a bongaka.
• Ga e nke sebaka sa ngaka kgotsa mooki.

Re ka botsa dipotso ka matshwenyego a gago go go thusa. Dikarabo tsa gago di ka bolokelwa ka polokeho go tokafatsa polokego le boleng jwa tirelo. Tshedimosetso ya gago e tla tshwariwa go ya ka melao ya sephiri ya Afrika Borwa (POPIA).

A o dumela go dirisa tirelo eno?

1 — Ee, ke a dumela mme ke batla go tswelela
2 — Nnyaa, tswa
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.4 `consent_yes` *(lib/messages.js)*

**English source:**
```
✅ Thank you. Let's get you to the right care.
```

**Setswana:**
```
✅ Re a leboga. Re go kaelele go tlhokafalo e e siameng.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.5 `consent_no` *(lib/messages.js)*

**English source:**
```
That's okay. Your session has ended and no information has been stored.

If you change your mind or need help in future, send "Hi" to start again. You can also visit your nearest clinic directly.

Take care. 🙏
```

**Setswana:**
```
Go siame. Seshene ya gago e fedile mme ga go na tshedimosetso e e bolokilweng.

Fa o fetola mogopolo kgotsa o tlhoka thuso mo isagong, romela "Hi" go simolola gape. O ka etela kliniki ya gago ya gaufi.

Inatale. 🙏
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.6 `category_menu` *(lib/messages.js)*

**English source:**
```
What is your main problem today?

1. 🫁 Breathing / Chest pain
2. 🤕 Head injury / Headache
3. 🤰 Pregnancy related
4. 🩸 Bleeding / Wound
5. 🤒 Fever / Flu / Cough
6. 🤢 Stomach / Vomiting
7. 👶 Child illness
8. 💊 Medication / Chronic
9. 🦴 Bone / Joint / Back pain
10. 🧠 Mental health
11. 🤧 Allergy / Rash
12. ✏️ Other — type your symptoms
13. 👤 Speak to a human
14. 🩺 Women's health (family planning)
15. 🔬 Health screening (HIV, BP, diabetes)
```

**Setswana:**
```
Ke eng bothata jwa gago jo bogolo gompieno?

1. 🫁 Mathata a go phefumola / Botlhoko jwa sehuba
2. 🤕 Go gobala tlhogo / Tlhogo e botlhoko
3. 🤰 Go ima
4. 🩸 Go opela / Ntho
5. 🤒 Fefo / Mokakatso / Go kgohlela
6. 🤢 Mpa / Go baba mpa
7. 👶 Bolwetsi jwa ngwana
8. 💊 Molemo / Bolwetsi jo bo sa feleleng
9. 🦴 Lesapo / Letswele / Mokokotlo
10. 🧠 Boitekanelo jwa mogopolo
11. 🤧 Aleji / Letswatswati
12. ✏️ Tse dingwe — kwala matshwenyego a gago
13. 👤 Bua le motho
14. 🩺 Boitekanelo jwa basadi (go rulaganya lapa)
15. 🔬 Tlhahlobo ya boitekanelo (HIV, BP, tshukere)
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.7 `triage_red` *(lib/messages.js)*

**English source:**
```
🔴 *EMERGENCY*

Call *10177* for an ambulance NOW.
If private: ER24 *084 124*.

⚠️ *Do NOT wait for the ambulance* — go to your nearest hospital emergency unit immediately. Ask someone to drive you or take a taxi.
```

**Setswana:**
```
🔴 *TSHOGANYETSO*

Leletsa *10177* go kopa ambulense JAANONG.
Praebete: ER24 *084 124*.

⚠️ *O SE KA WA EMA ambulense* — ya bookelong jo bo gaufi ka bonako. Kopa motho go go isa kgotsa o tseye thekisi.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.8 `triage_orange` *(lib/messages.js)*

**English source:**
```
🟠 *VERY URGENT*
You need care quickly.
```

**Setswana:**
```
🟠 *GO TSHOGANYETSO THATA*
O tlhoka tlhokomelo ka bonako.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.9 `clarify_symptoms` *(lib/messages.js)*

**English source:**
```
I need a little more information to assess your symptoms accurately.

Could you describe what you are feeling in more detail?

- Where exactly is the pain or discomfort?
- How long have you had this symptom?
- Is it getting worse, better, or staying the same?
```

**Setswana:**
```
Ke tlhoka tshedimosetso e nngwe go sekaseka matshwao a gago ka nepagalo.

A o ka tlhalosa se o ikutlwang ka botlalo?

- Ke kae go nepa botlhoko kgotsa go se itekanele?
- O na le seeme se nako e kae?
- Se a mpefala, se a tokafala, kgotsa se dula jalo?
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.10 `low_confidence_safety` *(lib/messages.js)*

**English source:**
```
ℹ️ We have assessed your symptoms, but our confidence is lower than usual. Your triage result is still shown above.

As a precaution:
- If your symptoms change or get worse, please come to the clinic *today*
- A nurse has been flagged to review your case
```

**Setswana:**
```
ℹ️ Re sekasekile matshwao a gago, mme boitshepo jwa rona bo kwa tlase go feta ka tlwaelo. Maduo a gago a sa bontshiwa fa godimo.

Jaaka tshireletso:
- Fa matshwao a gago a fetoga kgotsa a mpefala, tla kliniki *gompieno*
- Mooki o itsisiwe go sekaseka taba ya gago
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.11 `triage_orange_clinic` *(lib/messages.js)*

**English source:**
```
(name, dist) => `🏥 Go to *${name}* (${dist} km) NOW.\n\nTell reception you were triaged as *VERY URGENT* by BIZUSIZO. You will be fast-tracked.\n\nDo not wait at home.`
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.12 `triage_orange_hospital` *(lib/messages.js)*

**English source:**
```
The clinic is closed now. Go to your nearest hospital emergency unit immediately.
```

**Setswana:**
```
Kliniki e tswaletswe jaanong. Ya bookelong jo bo gaufi — ka karolong ya tshoganyetso.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.13 `ask_transport_safety` *(lib/messages.js)*

**English source:**
```
Can you travel to the facility safely?

1 — Yes, I can get there myself or someone can take me
2 — No, I am too unwell to travel safely
3 — I have no transport
```

**Setswana:**
```
O ka ya lefelong la kalafi ka polokesego?

1 — Ee, nka ya ka bonna kgotsa motho a ka ntisa
2 — Nnyaa, ke lwala thata go tsamaya ka polokesego
3 — Ga ke na sefata
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.14 `transport_safe` *(lib/messages.js)*

**English source:**
```
Good. Please leave now — do not delay.
```

**Setswana:**
```
Go siame. Tswelela pele jaanong — o se ke wa diega.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.15 `transport_unsafe` *(lib/messages.js)*

**English source:**
```
🚑 Call an ambulance NOW:
*10177* (public) or *084 124* (ER24)

Tell them your symptoms and location.

If the ambulance is slow, ask someone nearby to drive you to the nearest hospital emergency unit. Do not wait at home.
```

**Setswana:**
```
🚑 Letsa ambulense JAANONG:
*10177* (mmuso) kgotsa *084 124* (ER24)

Babuisa ka matshwenyego a gago le lefelo la gago.

Fa ambulense e diega, kopa motho yo o gaufi go go isa bookelong. O se ka wa ema gae.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.16 `transport_none` *(lib/messages.js)*

**English source:**
```
🚑 Call an ambulance: *10177* or *084 124* (ER24)

Alternatively, ask a neighbour, family member, or community member to take you. If you can reach a taxi rank, take a taxi to the nearest clinic or hospital.

Do not stay at home — you need care today.
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.17 `triage_yellow` *(lib/messages.js)*

**English source:**
```
🟡 *URGENT*
Visit a clinic today. Do not delay.
```

**Setswana:**
```
🟡 *GO A TSHOGANYETSA*
Etela kliniki gompieno. O se ka wa diega.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.18 `triage_yellow_after_hours` *(lib/messages.js)*

**English source:**
```
⏰ Clinics are closed now. Here is what to do:

1. *If your symptoms are manageable* — rest at home and go to the clinic first thing tomorrow morning (before 08:00 for the shortest wait)

2. *If symptoms worsen tonight* — go to your nearest hospital emergency unit or call *10177*

We will send you a reminder tomorrow morning.
```

**Setswana:**
```
⏰ Dikliniki di tswaletswe jaanong. Se o tshwanetseng go se dira ke se:

1. *Fa matshwao a gago a kgotlelega* — ikhutsa kwa gae o ye kliniki mo mosong ka bonako (pele ga 08:00)

2. *Fa matshwao a maswe bosigo* — ya bookelong jo bo gaufi kgotsa o leletse *10177*

Re tla go romela sekgopotso kamoso mo mosong.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.19 `queue_called` *(lib/messages.js)*

**English source:**
```
(assignedTo) => `📢 *You are being called!*\n\n${assignedTo ? 'Please go to *' + assignedTo + '* now.' : 'Please go to reception now.'}\n\nHave your ID and clinic card ready.`
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.20 `triage_green` *(lib/messages.js)*

**English source:**
```
🟢 *ROUTINE — Non-urgent*

Your symptoms are not an emergency. Here is some advice while you decide your next step:
```

**Setswana:**
```
🟢 *TSA TLWAELO — Ga se tshoganyetso*

Matshwao a gago ga se tshoganyetso. Dikeletso fa o akanya ka kgato e e latelang:
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.21 `facility_suggest` *(lib/messages.js)*

**English source:**
```
(name, dist) => `📍 Nearest facility: *${name}* (${dist} km away).\n\nCan you get there easily?\n1 — Yes, take me there\n2 — No, show me other options`
```

**Setswana:**
```
(name, dist) => `📍 Lefelo le le gaufi: *${name}* (${dist} km).\n\nO ka fitlha motlhofo?\n1 — Ee\n2 — Nnyaa, mpontshee tse dingwe`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.22 `facility_confirmed` *(lib/messages.js)*

**English source:**
```
(name) => `✅ Go to *${name}*.\n\n📋 *When you arrive:*\n1. Go to reception\n2. Tell them: "I used BIZUSIZO"\n3. Show your reference number (type *code* to see it)\n4. They already have your details\n\nSafe travels. We will check in with you in 48 hours.`
```

**Setswana:**
```
(name) => `✅ Ya go *${name}*.\n\n📋 *Fa o goroga:*\n1. Ya kwa go reception\n2. Ba bolelele: "Ke dirisitse BIZUSIZO"\n3. Ba bontshe nomoro ya gago (kwala *code*)\n4. Ba na le tshedimosetso ya gago\n\nO tsamae sentle. Re tla go botsa morago ga diura di le 48.`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.23 `facility_alternatives` *(lib/messages.js)*

**English source:**
```
(facilities, firstName) => `Here are other options nearby:\n${facilities}\n\n0 — Go back to the first suggestion${firstName ? ' (*' + firstName + '*)' : ''}\n\nReply with the number of your choice.`
```

**Setswana:**
```
(facilities, firstName) => `Ke mafelo a mangwe a gaufi:\n${facilities}\n\n0 — Boela kwa kgakololong ya ntlha${firstName ? ' (*' + firstName + '*)' : ''}\n\nAraba ka nomoro ya kgetho ya gago.`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.24 `follow_up` *(lib/messages.js)*

**English source:**
```
Hi, you contacted BIZUSIZO 2 days ago. How are your symptoms?
1. Better ✅
2. The same ➡️
3. Worse ⚠️
```

**Setswana:**
```
Dumela, o ikgolagantse le BIZUSIZO malatsi a 2 a a fetileng. Matshwao a gago a ntse jang?
1. A botoka ✅
2. A tshwana ➡️
3. A maswe go feta ⚠️
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.25 `follow_up_better` *(lib/messages.js)*

**English source:**
```
✅ Glad you are feeling better. No further action needed. Stay well!
```

**Setswana:**
```
✅ Re itumetse fa o ikutlwa botoka. Ga go tlhokege sepe gape. Nna sentle!
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.26 `follow_up_same` *(lib/messages.js)*

**English source:**
```
🟡 Please continue monitoring your symptoms. Visit a clinic if they do not improve in the next 24 hours.
```

**Setswana:**
```
🟡 Tswelela o ela tlhoko matshwao a gago. Etela kliniki fa a sa tokafale ka diura di le 24.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.27 `follow_up_worse` *(lib/messages.js)*

**English source:**
```
⚠️ Your symptoms may be worsening. A nurse has been notified and will review your case. If it is an emergency, call *10177* now.
```

**Setswana:**
```
⚠️ Matshwao a gago a ka nna a maswe. Mooki o itsisiwe. Fa e le tshoganyetso, leletsa *10177* jaanong.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.28 `follow_up_clinic_visit` *(lib/messages.js)*

**English source:**
```
One more question — did you visit the clinic after your triage?

1 — Yes, I went to the clinic ✅
2 — No, I did not go ❌
3 — I went to a hospital instead 🏥
4 — I went but was turned away ⛔
5 — I went but there was no medicine 💊
```

**Setswana:**
```
Potso e nngwe — a o ile kliniki morago ga go hlahlobiwa?

1 — Ee, ke ile kliniki ✅
2 — Nnyaa, ga ke ya ❌
3 — Ke ile bookelong esikhundleni 🏥
4 — Ke ile mme ka boelediwa ⛔
5 — Ke ile mme ga go na didirisiwa tsa kalafi 💊
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.29 `follow_up_clinic_thanks` *(lib/messages.js)*

**English source:**
```
Thank you. Your response helps us improve BIZUSIZO for everyone. Stay well. 🙏
```

**Setswana:**
```
Ke a leboga. Karabo ya gago e re thusa go tokafatsa BIZUSIZO. Nna sentle. 🙏
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.30 `request_location` *(lib/messages.js)*

**English source:**
```
📍 Please share your location so we can find the nearest facility.

Tap the 📎 (attachment) button → Location → Send your current location.
```

**Setswana:**
```
📍 Tswee-tswee abelana lefelo la gago gore re bone lefelo la kalafi le le gaufi.

Tobetsa konopo ya 📎 → Lefelo → Romela lefelo la gago la jaanong.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.31 `chronic_screening` *(lib/messages.js)*

**English source:**
```
Before we continue, do you take medication for any of these conditions? (Reply with the numbers, e.g. "1,3" or "0" for none)

0. None
1. 💊 HIV / ARVs
2. 🩸 High blood pressure
3. 🍬 Diabetes (sugar)
4. ❤️ Heart condition
5. 🫁 Asthma / Lung condition
6. 🧠 Epilepsy
7. 💊 Other chronic medication
```

**Setswana:**
```
Pele re tswelela, a o nwa melemo ya malwetse a? (Araba ka dinomoro, sk. "1,3" kgotsa "0" fa go sena)

0. Ga go na
1. 💊 HIV / Melemo ya ARV
2. 🩸 Madi a kwa godimo
3. 🍬 Bolwetse jwa sukiri
4. ❤️ Bolwetse jwa pelo
5. 🫁 Sefuba / Matshwafo
6. 🧠 Bolwetse jwa go wa
7. 💊 Melemo e mengwe ya go sa fole
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.32 `chronic_screening_saved` *(lib/messages.js)*

**English source:**
```
✅ Thank you. This helps us give you better guidance.
```

**Setswana:**
```
✅ Re a leboga. Se se re thusa go go fa kgakololo e e botoka.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.33 `ask_first_name` *(lib/messages.js)*

**English source:**
```
What is your first name? (As it appears on your ID)

Type your name:
```

**Setswana:**
```
Leina la gago ke mang? (Jaaka le kwadilwe mo go ID ya gago)

Kwala leina la gago:
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.34 `ask_surname` *(lib/messages.js)*

**English source:**
```
(firstName) => `Thank you, *${firstName}*.\n\nWhat is your surname / family name?\n\nType your surname:`
```

**Setswana:**
```
(firstName) => `Re a leboga, *${firstName}*.\n\nSefane sa gago ke mang?\n\nKwala sefane sa gago:`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.35 `ask_dob` *(lib/messages.js)*

**English source:**
```
What is your date of birth?

Type it like this: *DD-MM-YYYY*
Example: *15-03-1992*
```

**Setswana:**
```
Letsatsi la gago la matsalo ke lefe?

Kwala ka tsela e: *DD-MM-YYYY*
Sekai: *15-03-1992*
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.36 `ask_sex` *(lib/messages.js)*

**English source:**
```
What is your sex?

1 — Male
2 — Female
3 — Intersex
4 — Prefer not to say
```

**Setswana:**
```
Bong jwa gago ke eng?

1 — Monna
2 — Mosadi
3 — Intersex
4 — Ga ke batle go bolela
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.37 `identity_confirmed` *(lib/messages.js)*

**English source:**
```
(name, surname) => `✅ Thank you, *${name} ${surname}*. This helps the clinic prepare your file before you arrive.`
```

**Setswana:**
```
(name, surname) => `✅ Re a leboga, *${name} ${surname}*. Se se thusa kliniki go baakanya faele ya gago pele o goroga.`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.38 `ask_returning` *(lib/messages.js)*

**English source:**
```
(facilityName) => `Have you been to *${facilityName}* before?\n\n1 — Yes, I have a file there\n2 — No, this is my first visit\n3 — I'm not sure`
```

**Setswana:**
```
(facilityName) => `A o kile wa ya kwa *${facilityName}* pele?\n\n1 — Ee, ke na le faele koo\n2 — Nnyaa, ke ketelo ya me ya ntlha\n3 — Ga ke na bonnete`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.39 `returning_yes` *(lib/messages.js)*

**English source:**
```
📁 Good — the clinic will look for your file before you arrive.
```

**Setswana:**
```
📁 Go siame — kliniki e tla batla faele ya gago pele o goroga.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.40 `returning_new` *(lib/messages.js)*

**English source:**
```
🆕 No problem — the clinic will create a new file for you. This saves time when you arrive.
```

**Setswana:**
```
🆕 Ga go bothata — kliniki e tla dira faele e ntšhwa. Se se boloka nako fa o goroga.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.41 `returning_unsure` *(lib/messages.js)*

**English source:**
```
📋 No problem. The clinic will check when you arrive. Your name and date of birth will help them find your file quickly.
```

**Setswana:**
```
📋 Ga go bothata. Kliniki e tla tlhola fa o goroga. Leina la gago le letsatsi la matsalo di tla ba thusa go bona faele ya gago ka bonako.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.42 `study_participation` *(lib/messages.js)*

**English source:**
```
Are you taking part in the BIZUSIZO research study at a clinic?

1 — Yes, I am a study participant
2 — No, I am just using BIZUSIZO for myself
```

**Setswana:**
```
A o tsaya karolo mo patlisisong ya BIZUSIZO kwa kliniki?

1 — Ee, ke motsayakarolo wa patlisiso
2 — Nnyaa, ke dirisa BIZUSIZO fela
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.43 `study_code` *(lib/messages.js)*

**English source:**
```
(code) => `🔢 Your study code is: *${code}*\n\nPlease show this code to the research assistant when you arrive at the clinic. It helps us link your BIZUSIZO triage to your clinic visit.\n\nYou can also type "code" at any time to see your code again.`
```

**Setswana:**
```
(code) => `🔢 Khoutu ya gago ya patlisiso ke: *${code}*\n\nTswee-tswee bontsha khoutu e go mmatlisisi fa o goroga kliniki. E re thusa go golaganya triage ya gago ya BIZUSIZO le go etela ga gago kliniki.\n\nO ka kwala "code" nako nngwe le nngwe go bona khoutu ya gago gape.`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.44 `category_detail_prompt` *(lib/messages.js)*

**English source:**
```
(category) => `You selected: *${category}*\n\nHow bad is it?\n1 — Mild (I can do my daily activities)\n2 — Moderate (it's affecting my daily activities)\n3 — Severe (I can barely function)\n\nOr type your symptoms in your own words.\nYou can also send a voice note 🎤`
```

**Setswana:**
```
(category) => `O tlhophile: *${category}*\n\nGo maswe go le kana kang?\n1 — Bonnye (nka dira ditiro tsa ka tsa letsatsi le letsatsi)\n2 — Magareng (go ama ditiro tsa ka)\n3 — Thata (nka se kgone gotlhelele)\n\nKgotsa tlhalosa matshwao a gago ka mafoko a gago.\nO ka romela voice note 🎤`
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.45 `voice_note_prompt` *(lib/messages.js)*

**English source:**
```
🎤 You can send a voice note describing your symptoms. Speak clearly and tell us:

• What is wrong
• When it started
• How bad it is

We will listen to your message and help you.
```

**Setswana:**
```
🎤 O ka romela voice note o tlhalosa matshwao a gago. Bua sentle o re bolelele:

• Go diragala eng
• Go simolotse leng
• Go maswe go le kana kang

Re tla reetsa molaetsa wa gago re go thuse.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.46 `voice_note_received` *(lib/messages.js)*

**English source:**
```
🎤 Voice note received. Let me process your message...
```

**Setswana:**
```
🎤 Voice note e amogetšwe. A ke dire molaetsa wa gago...
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.47 `thinking` *(lib/messages.js)*

**English source:**
```
🔍 Assessing your symptoms...
```

**Setswana:**
```
🔍 Re sekaseka matshwao a gago...
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.48 `tips` *(lib/messages.js)*

**English source:**
```

💡 *Tips:*
Type *0* — new consultation
Type *language* — change language
Type *code* — show your reference number
```

**Setswana:**
```

💡 *Maele:*
Kwala *0* — puisano e ntšhwa
Kwala *puo* — fetola puo
Kwala *code* — bontsha nomoro ya gago
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.49 `rate_limited` *(lib/messages.js)*

**English source:**
```
⏳ You've sent a lot of messages in a short time. Please wait a few minutes before trying again.

🚨 *If this is an emergency:*
• Call *10177* (ambulance) or *084 124* (ER24)
• Go to your nearest clinic or hospital immediately
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.50 `system_timeout` *(lib/messages.js)*

**English source:**
```
⚠️ We are experiencing technical difficulties and cannot process your message right now.

🚨 *If this is an emergency:*
• Call *10177* (ambulance) or *084 124* (ER24)
• Go to your nearest clinic or hospital immediately — do not wait for an ambulance

We will try to respond as soon as the system is back. We apologise for the inconvenience.
```

**Setswana:**
```
⚠️ Re itemogela mathata a thekenoloji mme re ka se kgone go dira molaetsa wa gago jaanong.

🚨 *Fa e le tshoganyetso:*
• Leletsa *10177* (ambulense) kgotsa *084 124* (ER24)
• Ya kliniki kgotsa bookelong jo bo gaufi JAANONG — o se ka wa ema ambulense

Re tla leka go araba fa tshedimosetso e boetse. Re kopa maitshwarelo.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.51 `development_notice` *(lib/messages.js)*

**English source:**
```
Thank you for contacting BIZUSIZO 🏥

This system is currently under development and is not yet available for public use.

🚨 *If you are experiencing a medical emergency:*
• Call *10177* (ambulance) or *084 124* (ER24)
• Go to your nearest clinic or hospital IMMEDIATELY

For more information, visit bizusizo.co.za

Siyabonga / Enkosi / Dankie / Re a leboga / Re a leboha
```

**Setswana:**
*(Not language-specific — shown in all languages at once.)*

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1B. Chronic medication (CCMDD) messages (index.js)

### 1.52 `chronic_check` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
Are you here for a chronic medication refill?\n1 — Yes, I need my regular medication\n2 — No, I have new or worsening symptoms
```

**Setswana:**
```
A o fano bakeng sa go tlatsa dimelemo tsa go nnela ruri?\n1 — Ee, ke tlhoka dimelemo tsa me tsa ka metlha\n2 — Nnyaa, ke na le matshwao a masha kgotsa a maswe
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.53 `condition_check` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
What medication do you collect? (Select all that apply)
1 — ARVs (HIV)
2 — Blood pressure / Hypertension
3 — Diabetes (sugar)
4 — Heart / Angina
5 — Asthma / Lung
6 — Epilepsy
7 — Other chronic medication
```

**Setswana:**
```
O tsaya dimelemo dife? (Kgetha tsotlhe tse di amanang)\n1 — Di-ARV (HIV)\n2 — Madi a kwa godimo\n3 — Sukiri (Diabetes)\n4 — Pelo / Angina\n5 — Sehuba / Mafahla\n6 — Bolwetse jwa go wa (Epilepsy)\n7 — Dimelemo tse dingwe tsa go nnela ruri
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.54 `ccmdd_route` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
💊 Your nearest medication pickup point is:\n*${name}* (${dist} km)\n\nYou can collect your chronic medication there without queuing at a clinic.\n\nCan you get there?\n1 — Yes\n2 — No, show alternatives
```

**Setswana:**
```
💊 Lefelo la gago la gaufi la go tsaya dimelemo ke:\n*${name}* (${dist} km)\n\nO ka tsaya dimelemo tsa gago tsa go nnela ruri gone go sa eme molelwaneng kwa kliniki.\n\nA o ka fitlha?\n1 — Ee\n2 — Nnyaa, mpontsha tse dingwe
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.55 `ccmdd_confirmed` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
✅ Go to *${name}* to collect your medication.\n\nRemember to bring your ID and prescription/clinic card.\n\nWe will remind you when your next collection is due.
```

**Setswana:**
```
✅ Ya kwa go *${name}* go tsaya dimelemo tsa gago.\n\nGopola go tlisa ID ya gago le karata ya kliniki.\n\nRe tla go gopotsa fa nako ya go tsaya e e latelang e fitlhile.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.56 `ccmdd_not_available` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
💊 CCMDD pickup is not yet available in your area. Please visit your nearest clinic for your medication refill.
```

**Setswana:**
```
💊 Go tsaya dimelemo ga go eso nne gone mo lefelong la gago. Etela kliniki e e gaufi go tlatsa dimelemo.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.57 `reminder_24h` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
💊 Reminder: Your medication is ready for collection at *${name}*.\n\nPlease collect today if possible. Your health depends on taking your medication consistently.
```

**Setswana:**
```
💊 Kgopotso: Dimelemo tsa gago di lokile go tsewa kwa *${name}*.\n\nDi tseye gompieno fa go kgonagala. Boitekanelo jwa gago bo ikaegile ka go nwa dimelemo ka metlha.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.58 `reminder_48h` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
⚠️ Your medication at *${name}* has not been collected yet.\n\nMissing your medication can cause your condition to worsen. Please collect as soon as possible.\n\nHaving trouble getting there?\n1 — I will collect today\n2 — I cannot get to this location\n3 — I have a problem (tell us)
```

**Setswana:**
```
⚠️ Dimelemo tsa gago kwa *${name}* ga di eso tsewa.\n\nGo palelwa ke go tsaya dimelemo go ka dira maemo a gago a nne maswe. Di tseye ka bonako.\n\nA o na le bothata jwa go fitlha?\n1 — Ke tla di tsaya gompieno\n2 — Ga ke kgone go fitlha lefelong le\n3 — Ke na le bothata (re bolelele)
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.59 `reminder_72h_escalation` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
🔴 You have not collected your medication for 3 days.\n\nMissing medication puts your health at serious risk. A healthcare worker has been notified.\n\nPlease tell us what is preventing you from collecting:\n1 — Transport / distance problem\n2 — Cannot take time off work\n3 — Pickup point was closed when I went\n4 — Medication was not available\n5 — Side effects — I stopped taking medication\n6 — Other reason
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.60 `missed_transport` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
We understand. Let us find a closer pickup point for your next collection. Please share your location.
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.61 `missed_work` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
We understand. We are working on extended collection hours and weekend options. For now, you can ask someone you trust to collect on your behalf with your ID and clinic card.
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.62 `missed_closed` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
Thank you for telling us. We have logged this issue and will follow up with the pickup point. Please try again tomorrow, or we can suggest an alternative location.
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.63 `missed_no_stock` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
Thank you for telling us. We have reported this stock issue. We will notify you as soon as your medication is available. We are sorry for the inconvenience.
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.64 `missed_side_effects` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
⚠️ Please do not stop taking your medication without speaking to a healthcare worker first. Stopping suddenly can be dangerous.\n\nA nurse has been notified and will contact you to discuss your side effects and explore alternatives.\n\nIf you feel very unwell, call *10177* or visit your nearest clinic.
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.65 `reengagement` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
Hello from BIZUSIZO 💊\n\nWe noticed you haven't collected your chronic medication recently. We know life gets busy and collecting can be difficult.\n\nWe want to help you get back on track. Your health matters.\n\nWould you like help finding a convenient pickup point?\n1 — Yes, help me collect my medication\n2 — I am collecting elsewhere now\n3 — I need to speak to someone
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.66 `multimorbidity_warning` *(index.js → CCMDD_MESSAGES)*

**English source:**
```
⚠️ Important: You collect medication for *${conditions}*. Missing your medication affects ALL of these conditions. Please collect as soon as possible.
```

**Setswana:**
```
⚠️ [MISSING — PLEASE TRANSLATE]
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1C. Virtual consult messages (index.js)

### 1.67 `offer` *(index.js → VIRTUAL_CONSULT_MESSAGES)*

**English source:**
```
📱 A virtual consultation may be available for your condition.\n\nYou can speak to a healthcare worker by video call instead of travelling to a clinic.\n\nWould you like to:\n1 — Book a virtual consultation\n2 — No thanks, I'll visit a clinic in person
```

**Setswana:**
```
📱 Go bonana ka video go ka nna gone bakeng sa maemo a gago.\n\nO ka bua le mooki ka video call go na le go ya kliniki.\n\nA o ka rata:\n1 — Go beya go bonana ka video\n2 — Nnyaa ke a leboga, ke tla etela kliniki
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.68 `booking_api` *(index.js → VIRTUAL_CONSULT_MESSAGES)*

**English source:**
```
✅ Your virtual consultation has been booked. You will receive a confirmation message with the date, time, and video link.
```

**Setswana:**
```
✅ Go bonana ga gago ka video go beilwe. O tla amogela molaetsa wa go tiisa ka letsatsi, nako, le linki ya video.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.69 `booking_whatsapp` *(index.js → VIRTUAL_CONSULT_MESSAGES)*

**English source:**
```
📱 To book your virtual consultation, please message this number on WhatsApp:\n\n*${phone}*\n\nTell them BIZUSIZO referred you and describe your symptoms.
```

**Setswana:**
```
📱 Go buka go bonana ga gago ka video, romela molaetsa go nomoro e ka WhatsApp:\n\n*${phone}*\n\nBa bolelele gore BIZUSIZO e go romeleng mme o tlhalose matshwao a gago.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.70 `not_available` *(index.js → VIRTUAL_CONSULT_MESSAGES)*

**English source:**
```
📱 Virtual consultations are not yet available in your area. Please visit your nearest clinic.
```

**Setswana:**
```
📱 Go bonana ka video ga go eso nne gone mo lefelong la gago. Etela kliniki e e gaufi.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1D. Lab result messages (index.js)

### 1.71 `result_ready` *(index.js → LAB_MESSAGES)*

**English source:**
```
📋 Your *${testType}* results are ready.\n\nPlease visit your clinic to discuss the results with your healthcare provider.\n\nIf you have been referred back to the clinic, this does NOT mean something is wrong — many results are routine check-ups.\n\nQuestions? Reply "results" or call your clinic.
```

**Setswana:**
```
📋 Dipholo tsa gago tsa *${testType}* di lokile.\n\nEtela kliniki ya gago go buisana le mooki ka dipholo.\n\nFa o buseditswe kliniki, se GA SE reye gore go na le bothata — dipholo tse dintsi ke tsa go tlhatlhoba ka tlwaelo.\n\nDipotso? Araba "dipholo" kgotsa leletsa kliniki ya gago.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.72 `result_action_required` *(index.js → LAB_MESSAGES)*

**English source:**
```
📋 Your *${testType}* results are ready and your healthcare provider would like to see you.\n\nPlease visit your clinic within the next 7 days. This is important for your ongoing care.\n\nIf you cannot get to the clinic, reply "help" and we will assist you.
```

**Setswana:**
```
📋 Dipholo tsa gago tsa *${testType}* di lokile mme mooki wa gago o batla go go bona.\n\nEtela kliniki ya gago mo malatsing a 7 a a tlang. Se se botlhokwa bakeng sa tlhokomelo ya gago.\n\nFa o sa kgone go fitlha kliniki, araba "thuso" mme re tla go thusa.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.73 `result_normal` *(index.js → LAB_MESSAGES)*

**English source:**
```
✅ Good news! Your *${testType}* results are back and everything looks normal.\n\nKeep taking your medication as prescribed. Your next check-up will be scheduled as usual.\n\nStay well! 💚
```

**Setswana:**
```
✅ Dikgang tse di monate! Dipholo tsa gago tsa *${testType}* di boile mme tsotlhe di bonala di siame.\n\nTswela pele go nwa dimelemo tsa gago jaaka o laetswe. Go tlhatlhoba ga gago go go latelang go tla rulaganngwa ka tlwaelo.\n\nNna sentle! 💚
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.74 `check_status` *(index.js → LAB_MESSAGES)*

**English source:**
```
Let me check your lab results. One moment please...
```

**Setswana:**
```
A ke tlhatlhobe dipholo tsa gago tsa laborathori. Motsotswana o le mongwe...
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.75 `no_results` *(index.js → LAB_MESSAGES)*

**English source:**
```
We do not have any lab results on file for you at the moment. If you are expecting results, please check with your clinic.\n\nResults typically take 3-7 working days depending on the test type.
```

**Setswana:**
```
Ga re na dipholo tsa laborathori ka wena ka nako e. Fa o letetse dipholo, botsa kliniki ya gago.\n\nDipholo ka tlwaelo di tsaya malatsi a 3-7 a tiro go ya ka mofuta wa teko.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---

### 1.76 `pending_results` *(index.js → LAB_MESSAGES)*

**English source:**
```
Your *${testType}* test from *${testDate}* is still being processed. We will notify you on WhatsApp as soon as results are available.\n\nYou do not need to visit the clinic to check — we will come to you.
```

**Setswana:**
```
Teko ya gago ya *${testType}* ya *${testDate}* e sa ntse e dirwa. Re tla go itsise ka WhatsApp fa dipholo di le teng.\n\nGa o tlhoke go etela kliniki go tlhatlhoba — re tla tla go wena.
```

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ add (below)

**Notes / corrections / additions:**

---


## PART 2 — Clinical safety keywords (58 rules)

The system scans patient text for keyword combinations and assigns a triage level (RED = emergency, ORANGE = very urgent, YELLOW = urgent) **independent of the AI**. Each rule below shows the English trigger phrases (so you know what the rule is for) and the current Setswana keywords the system recognises. These are natural patient phrasings, not clinical terminology.

**For each rule, please:**
1. Confirm the listed Setswana keywords are correct and natural for how a patient would type on WhatsApp.
2. Add any common phrasings a patient might use for this symptom that are **not** currently listed.
3. Flag any keyword that sounds unnatural, overly formal, or potentially misleading.

**Priority:** ✨ high (RED rules, life-threatening) · important (ORANGE) · ⚪ lower priority (YELLOW)

### RED discriminators

#### RED 1. `respiratory_cardiac_arrest`
*── RED DISCRIMINATORS ── | ════════════════════════════════════════════════════════════════ | RED 1: RESPIRATORY / CARDIAC ARREST — not breathing, heart stopped | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `a a hefemuli`
- `a a phefumolohe`
- `awaphefumuli`
- `cardiac arrest`
- `heart stopped`
- `inhliziyo yama`
- `inhliziyo yema`
- `no breathing`
- `not breathing`
- `stopped breathing`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 2. `unconscious`
*════════════════════════════════════════════════════════════════ | RED 2: UNCONSCIOUS — unresponsive, not waking, collapsed | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `a a hlamuli`
- `abuyi`
- `alawuli`
- `alibeki`
- `angaphaphami`
- `aziphaphami`
- `collapsed and not moving`
- `ga a tsoge`
- `ha a arabe`
- `limp and not moving`
- `not waking`
- `o wele fase`
- `passed out`
- `unconscious`
- `unresponsive`
- `uwele phansi`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `ga a arabe`
- `o wetse fa fatshe`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 3. `active_seizure`
*════════════════════════════════════════════════════════════════ | RED 3: ACTIVE SEIZURE — currently fitting, convulsing | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `body shaking uncontrolled`
- `convulsing now`
- `currently fitting`
- `fitting now`
- `having a fit`
- `isidina manje`
- `o tshwerwe ke bolwetse`
- `seizure now`
- `shaking and not stopping`
- `u swiwa nga vhulwadze`
- `unamaxhala ngoku`
- `unyikinyeka ngoku`
- `val nou`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 4. `cardiac_emergency`
*════════════════════════════════════════════════════════════════ | RED 4: CARDIAC EMERGENCY — chest pain + breathing difficulty | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `a ndzi hefemuli`
- `a thi fembi`
- `asem`
- `asemhaling`
- `chest pain`
- `difficulty breathing`
- `ga ke heme`
- `go hema`
- `go hema go thata`
- `ho phefumoloha`
- `ku hefemula`
- `ku hefemula ku tika`
- `kuphefumula`
- `kuphefumula kumatima`
- `phefumla`
- `phefumula`
- `short of breath`
- `shortness of breath`
- `sifuba`
- `struggling to breathe`
- `tshifuva`
- `u femba`
- `u femba hu a onda`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 5. `cardiac_emergency_radiation`
*Complements the chest+breathing rule above. Surfaced by eval P01: chest + arm | heaviness + sweating had no deterministic net; LLM caught it at 95% confidence | but no fallback existed. Extended to all 11 languages (nso/tn/st/ts/ss/ve/nr | pending native-speaker review).*

**English trigger phrases** (what the rule looks for in English):
- `arm aching`
- `arm feels heavy`
- `arm feels numb`
- `arm heavy`
- `arm is dof`
- `arm is heavy`
- `arm is numb`
- `arm numb`
- `arm tingling`
- `chest discomfort`
- `chest heaviness`
- `chest hurts`
- `chest is heavy`
- `chest pain`
- `chest pressure`
- `chest tight`
- `chest tightness`
- `clammy`
- `cold sweat`
- `cold sweats`
- `diaphoresis`
- `in my arm`
- `ingalo ibuhlungu`
- `ingalo inzima`
- `jaw ache`
- `jaw hurts`
- `jaw pain`
- `left arm`
- `left shoulder`
- `letsogo le boima`
- `letsoho le boima`
- `mofufutsho o tsididi`
- `mohonga u vhavha`
- `muheme wa tsunda`
- `muheme wu vava`
- `my arm`
- `o fufuleha mofufutsho o batang`
- `o fufulela phefo e tonyago`
- `pain down my shoulder`
- `pain in jaw`
- `pain in my jaw`
- `pain to shoulder`
- `radiating`
- `right arm`
- `seledu se bohloko`
- `shoulder pain`
- `spreading to`
- `spreads to`
- `sweating`
- `sweaty`
- `sweet bars`
- `tshanḓa tsho lemala`
- `u suka ngoho`
- `uyabila`
- `voko ri tika`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 6. `acs_radiation`
*════════════════════════════════════════════════════════════════ | RED 5: ACS RADIATION — chest pain + arm/jaw pain + sweating | Extended to all 11 languages (nso/tn/st/ts/ss/ve/nr pending native-speaker review) | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `arm`
- `arm pain`
- `chest hurts`
- `chest pain`
- `chest tight`
- `feels like something sitting on my chest`
- `fhungo`
- `ihlombe`
- `ingalo`
- `iqatha`
- `jaw pain`
- `khana`
- `left arm`
- `legetla`
- `lehetla`
- `letsogo`
- `letsoho`
- `lihlombe`
- `mofufutšo`
- `o a fufuleha`
- `o a fufulela`
- `rikatla`
- `shoulder pain`
- `sifuba`
- `skouer`
- `sweating`
- `sweet`
- `sweetvogtig`
- `tshanḓa`
- `u a suka`
- `u a suza`
- `uyabila`
- `voko`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 7. `obstetric_haemorrhage`
*st | ════════════════════════════════════════════════════════════════ | RED 6: OBSTETRIC HAEMORRHAGE — pregnant + bleeding | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `bleeding`
- `bleeding heavily`
- `blood`
- `haemorrhage`
- `hemorrhage`
- `ingati`
- `ke ipaakanyeditse`
- `madi`
- `massive bleeding`
- `ngati`
- `o imile`
- `opha`
- `pregnancy`
- `pregnant`
- `swangari`
- `zwigolo`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 8. `obstetric_cord_or_fetal`
*════════════════════════════════════════════════════════════════ | RED 7: OBSTETRIC CORD / FETAL EMERGENCY | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `baba beweeg nie`
- `baby not moving`
- `baby stopped moving`
- `cord came out`
- `cord is out`
- `mhahla wu humile`
- `mohara o tsoile`
- `mohara o tswile`
- `mohara o tšwile`
- `mohlola wo bva`
- `ngwana ga a šikinyege`
- `ngwana ha a tshikinyege`
- `no fetal movement`
- `nwana a a tshikinyeki`
- `prolapsed cord`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `ngwana ga a tshikinyege`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 9. `envenomation`
*════════════════════════════════════════════════════════════════ | RED 8: SNAKE BITE — all 11 languages | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `bit by snake`
- `bitten by snake`
- `noga e nkometse`
- `nyoka yi n\'wi lumile`
- `snake bit`
- `snake bite`
- `snakebite`
- `ṋowa`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 10. `severe_burns`
*════════════════════════════════════════════════════════════════ | RED 9: SEVERE BURNS | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `body on fire`
- `burn from explosion`
- `burning all over`
- `burns to face and hands`
- `burnt all over`
- `izandla nobuso kushisile`
- `izandla nobuso zitshisiwe`
- `large burn`
- `meetse a go fisha`
- `metsi a chesang`
- `o cheswe`
- `o tshiwa`
- `severe burn`
- `u pfile`
- `ushiswe kakhulu`
- `vuur oor liggaam`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `metsi a a fisang`
- `o tšhutse`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 11. `severe_burns_context`
*severe_burns_context*

**English trigger phrases** (what the rule looks for in English):
- `back`
- `bene`
- `boiling water on`
- `bors`
- `buso`
- `chest`
- `face`
- `gesig`
- `imilente`
- `imilenze`
- `isisu`
- `khana`
- `khwiri`
- `legs`
- `lumbu`
- `maag`
- `maoto`
- `milenge`
- `milenzhe`
- `mokokotlo`
- `mokwatla`
- `mpa`
- `muṱana`
- `ngalati`
- `nkolo`
- `rug`
- `sefahlego`
- `sefahleho`
- `sifuba`
- `sisu`
- `stomach`
- `tshifhaṱuwo`
- `umhlana`
- `umhlane`
- `xikandza`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `metsi a a fisang godimo ga`
- `sefatlhego`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 12. `neonatal_apnoea`
*════════════════════════════════════════════════════════════════ | RED 10: NEONATAL APNOEA / PAEDIATRIC UNCONSCIOUS | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `baby not breathing`
- `baby stopped breathing`
- `infant not breathing`
- `newborn not breathing`
- `nwana a a hefemuli`
- `nwana lontsongo a nga hefemuli`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 13. `paediatric_unconscious`
*paediatric_unconscious*

**English trigger phrases** (what the rule looks for in English):
- `baby unconscious`
- `child unconscious`
- `infant unconscious`
- `ngwana o wetse`
- `ngwana o wetse fatshe`
- `nwana a nga vuki`
- `toddler collapsed`
- `umntwana oqulekile`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 14. `meningococcal_rash`
*════════════════════════════════════════════════════════════════ | RED 11: MENINGOCOCCAL RASH — purple/non-blanching | Extended to all 11 languages (nso/tn/st/ts/ve/nr pending native-speaker review) | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `,                            // nso`
- `,                            // st`
- `,                            // tn`
- `,                           // af`
- `,                       // ve`
- `,                   // ss`
- `,                // zu`
- `,       // xh`
- `,     // ts`
- `,    // af`
- `blood rash`
- `dark rash`
- `non-blanching rash`
- `purple rash`
- `rash pressing glass`
- `t fade`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 15. `anaphylaxis`
*st | ════════════════════════════════════════════════════════════════ | RED 12: ANAPHYLAXIS — throat/face swelling after sting/food | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `bee`
- `bye`
- `dijo`
- `face swelling`
- `food allergy`
- `imbumba`
- `injection`
- `inspuiting`
- `kos`
- `lips swelling`
- `medication`
- `moento`
- `mpfundla`
- `nonyane`
- `nose`
- `nut`
- `nyosi`
- `sting`
- `swakudya`
- `throat closing`
- `throat swelling`
- `umjovo`
- `zwiliwa`
- `ṋovhela`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `molomo o rurugile`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### RED 16. `traumatic_haemorrhage`
*════════════════════════════════════════════════════════════════ | RED 13: TRAUMATIC HAEMORRHAGE — uncontrollable bleeding | ════════════════════════════════════════════════════════════════*

**English trigger phrases** (what the rule looks for in English):
- `blood everywhere`
- `blood pouring`
- `ingati ayinqamuki`
- `ingati iyampompoza`
- `madi a a elela`
- `madi a elela`
- `madi ga a eme`
- `madi ha a eme`
- `ngati a yi yimi`
- `ngati yi humesa`
- `o hlabilwe`
- `o ṱhavhiwa`
- `shot and bleeding`
- `spurting blood`
- `stabbed and bleeding`
- `u tlhabiwe`
- `udutshulwe`
- `udutyulwe`
- `ugwaziwe`
- `ugwazwe`
- `uhlabwe`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

### ORANGE discriminators

#### ORANGE 1. `stroke_facial_droop`
*── ORANGE DISCRIMINATORS ── | STROKE — facial droop, arm weakness, speech (FAST signs) — all 11 languages*

**English trigger phrases** (what the rule looks for in English):
- `buso buyehla`
- `face drooping`
- `face dropped`
- `facial droop`
- `gesig hang`
- `molomo o kgopame`
- `molomo o kgopiše`
- `mond skeef`
- `mouth twisted`
- `mulomo wo goba`
- `nomo wu gombile`
- `one side face`
- `smile crooked`
- `tshifhaṱuwo tsho thela`
- `uneven face`
- `xikandza xi rhelerile`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `sefatlhego se theogetse`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 2. `stroke_arm_weakness`
*stroke_arm_weakness*

**English trigger phrases** (what the rule looks for in English):
- `arm dropping`
- `arm is swak`
- `arm numb`
- `arm weakness`
- `hand weak`
- `ingalo ayinyakazi`
- `ingalo ibhudlana`
- `ingalo ibuthathaka`
- `kan nie arm oplig`
- `left side weak`
- `letsogo ga le tshikinyege`
- `letsogo ga le šikinyege`
- `letsoho ha le tshikinyehe`
- `one arm weak`
- `right side weak`
- `tshanḓa a tshi tshikinyei`
- `voko a ri tshikinyeki`
- `weakness one side`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `letsogo le bokoa`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 3. `stroke_speech`
*stroke_speech*

**English trigger phrases** (what the rule looks for in English):
- `amazwi akaphumi kakuhle`
- `amazwi awaphumi kahle`
- `confused talking`
- `emagama akaphumi kahle`
- `maipfi ha a ḓi bvi zwavhuḓi`
- `slurred speech`
- `speech slurred`
- `talking funny`
- `woorde kom nie uit`
- `words wrong`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `mafoko ga a tswe sentle`
- `o bua thata`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 4. `thunderclap_headache`
*thunderclap_headache*

**English trigger phrases** (what the rule looks for in English):
- `explosive headache`
- `headache like never before`
- `sudden severe headache`
- `thunderclap`
- `worst headache`
- `worst headache of my life`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `tlhogo e e bohloko thata ka tshoganyetso`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 5. `post_ictal`
*POST-ICTAL — had a fit, now confused/drowsy — all 11 languages*

**English trigger phrases** (what the rule looks for in English):
- `akavuki`
- `confused`
- `drowsy`
- `finished fitting`
- `fit stopped`
- `ga a tsoge`
- `go rotha go fedile`
- `had a seizure`
- `ho ratha ho fedile`
- `just fitted`
- `just had a fit`
- `ku rhurhumela ku hele`
- `not fully awake`
- `o dzhendzhele`
- `o eḓela`
- `o kile a ratha`
- `o qetile go rotha`
- `o robetse`
- `o robetše`
- `seizure stopped`
- `sleepy`
- `u dzhendzela ho fhela`
- `u rhurhumele`
- `uyozela`
- `woke up after fit`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 6. `severe_asthma`
*SEVERE ASTHMA — inhaler not working, can't speak*

**English trigger phrases** (what the rule looks for in English):
- `a i shumi`
- `a i thusi`
- `a yi pfuni`
- `a yi tirhi`
- `asma`
- `asthma`
- `ayincedi`
- `ayisizi`
- `exhausted`
- `ga e bereke`
- `ga e thuse`
- `ga e thuše`
- `ga e šome`
- `getting worse`
- `ha e sebetse`
- `ha e thuse`
- `help nie`
- `inhaler`
- `iphampu`
- `kan nie praat`
- `lips blue`
- `nebuliser`
- `not helping`
- `not working`
- `pampu`
- `pompi`
- `pump`
- `turning blue`
- `werk nie`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 7. `pre_eclampsia`
*PRE-ECLAMPSIA — pregnant + headache + swelling/vision (all 11 languages)*

**English trigger phrases** (what the rule looks for in English):
- `amehlo ayafifiala`
- `blurred vision`
- `face swollen`
- `feet very swollen`
- `gesig geswel`
- `hands swollen`
- `headache`
- `hlogo`
- `hloho`
- `mahlo a fifala`
- `matlho a fifala`
- `ndo vhifha`
- `no urine`
- `o imile`
- `pain under ribs`
- `pregnant`
- `seeing stars`
- `swangari`
- `tlhogo`
- `ṱhoho`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `sefatlhego se rurugile`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 8. `ectopic_pregnancy`
*ECTOPIC PREGNANCY — missed period + severe one-sided pain*

**English trigger phrases** (what the rule looks for in English):
- `bohloko ba lehetla`
- `bohloko bja legetla`
- `bohloko bjo bogolo ka lehlakoreng le tee`
- `bohloko bo boholo ka lehlakoreng le le leng`
- `bohloko jo bogolo mo letlhakoreng le lengwe`
- `bohloko jwa legetla`
- `buhlungu lobukhulu ngelinye lihlangotsi`
- `could be pregnant`
- `erge pyn aan een kant`
- `fhungo ḽi vhavha`
- `ihlombe libuhlungu`
- `iperiod ilate`
- `iqatha libuhlungu`
- `isikhathi asifikanga`
- `kgwedi ga e fihla`
- `kgwedi ga e tle`
- `kgwedi ha e fihle`
- `ku vava ka matimba hi tlhelo rin\'we`
- `left side severe`
- `lihlombe libuhlungu`
- `masiku a wu fiki`
- `missed period`
- `nako ga e fihla`
- `nako ga e tle`
- `nako ha e fihle`
- `ngakwesobunxele ibuhlungu kakhulu`
- `nkarhi a wu fiki`
- `period late`
- `pregnancy test positive`
- `right side severe`
- `rikatla ri vava`
- `severe pain one side`
- `sharp pain left side`
- `sharp pain right side`
- `shoulder pain`
- `shoulder tip pain`
- `sikhatsi asifikanga`
- `skerp pyn links`
- `skerp pyn regs`
- `skouer pyn`
- `tip of shoulder`
- `tshifhinga a tshi ḓi`
- `vhutungu vhuhulu tshipiḓa tshithihi`
- `ṅwedzi a u ḓi`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 9. `febrile_seizure`
*ts | FEBRILE SEIZURE — child + fit + fever (all 11 languages)*

**English trigger phrases** (what the rule looks for in English):
- `baba`
- `baby`
- `banjwa`
- `child`
- `convulsion`
- `dzhendzela`
- `fever`
- `fit`
- `fitting`
- `hot`
- `infant`
- `kind`
- `kleuter`
- `ngwana`
- `nhanga`
- `nwana`
- `phoholo`
- `rhurhumela`
- `rotha`
- `seizure`
- `shaking`
- `temperature`
- `temperatuur`
- `thothomela`
- `thuthumela`
- `toddler`
- `umkhuhlane`
- `umntwana`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 10. `infant_sepsis_screen`
*ts | FEBRILE SEIZURE — child + fit + fever (all 11 languages)*

**English trigger phrases** (what the rule looks for in English):
- `,
      "", "",`
- `,
      // multilingual infant / newborn markers`
- `,                                              // ss`
- `,                                              // st / nso / tn`
- `,                                             // ss`
- `,                                            // xh / ss`
- `,                                         // ve`
- `,                                         // xh`
- `,                                       // ve`
- `,                                      // nso / tn`
- `,                                    // ts`
- `,                                  // af`
- `,                                  // st`
- `,                                 // nso / tn`
- `,                                 // st`
- `,                                // af`
- `,                              // ts`
- `,                        // zu / ss / xh`
- `,                       // ss`
- `,                       // zu`
- `,                      // tn`
- `,                     // ts`
- `,                    // ve`
- `,                  // zu`
- `,                 // af`
- `,                // nso`
- `,                // ts`
- `,             // st`
- `,        // af`
- `,   // af`
- `, "",`
- `, // xh / zu`
- `// nr
    );

    if (isinfant && infanthasfever && (infantpoorfeeding || infantlethargy)) {
      logger.warn(`
- `// ve
    );

    const infantlethargy = has(`
- `// ve
    );

    const infantpoorfeeding = has(
      "",`
- `// xh — ""
    );

    const infanthasfever = has(`
- `baba`
- `baby`
- `banjwa`
- `child`
- `convulsion`
- `dzhendzela`
- `febrile_seizure`
- `fever`
- `fit`
- `fitting`
- `hot`
- `infant`
- `kind`
- `kleuter`
- `ngwana`
- `nhanga`
- `nwana`
- `phoholo`
- `rhurhumela`
- `rotha`
- `seizure`
- `shaking`
- `temperature`
- `temperatuur`
- `thothomela`
- `thuthumela`
- `toddler`
- `umkhuhlane`
- `umntwana`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 11. `acute_confusion_chronic`
*st | ACUTE CONFUSION + CHRONIC DISEASE — all 11 languages*

**English trigger phrases** (what the rule looks for in English):
- `a a tivi`
- `akati`
- `akazi`
- `arv`
- `confused`
- `deurmekaar`
- `diabetes`
- `diabetic`
- `ga a itse`
- `ga a tsebe`
- `ha a tsebe`
- `ha a ḓivhi`
- `high blood`
- `hiv`
- `hypertension`
- `maak nie sin`
- `not making sense`
- `sugar`
- `suiker`
- `talking nonsense`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `bolwetse jwa sukiri`
- `madi a godileng`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 12. `head_trauma_loc`
*HEAD TRAUMA + LOC — head injury + loss of consciousness or altered state. All 11 languages.*

**English trigger phrases** (what the rule looks for in English):
- `a ndzi tsundzuki`
- `a thi humbuli`
- `andikhumbuli`
- `blacked out`
- `bump to head`
- `confused after`
- `deurmekaar na val`
- `fell and hit head`
- `ga ke gakologelwe`
- `ga ke gopole`
- `geheueverlies`
- `ha ke hopole`
- `head injury`
- `head trauma`
- `hit head`
- `ke didimatse morago`
- `ke didimetse ka morao`
- `ke didimetse morago`
- `ke idibetse`
- `ke itshedisitse`
- `ke ngwele ka hlogo`
- `ke oele hlohong`
- `ke ole ka tlhogo`
- `knocked head`
- `knocked out`
- `lost consciousness`
- `memory loss`
- `ndidideke emva`
- `ndiquleke`
- `ndiwe phantsi`
- `ndo wa nda vhaisa ṱhoho`
- `ndzi didimele endzhaku`
- `ndzi wile ndzi dumba nhloko`
- `ndzi wisile`
- `ngashona`
- `passed out`
- `unconscious`
- `vomiting after`
- `woke up confused`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `ke iteilwe mo tlhogong`
- `kgobalo ya tlhogo`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 13. `open_fracture`
*ss | OPEN FRACTURE — bone visible through skin. All 11 languages.*

**English trigger phrases** (what the rule looks for in English):
- `been uit vel`
- `bone sticking out`
- `bone through skin`
- `bone visible`
- `can see bone`
- `ithambo liphukile liphumele ngaphandle`
- `lerapo le robegile le tswa`
- `lerapo le robegile le tšwa`
- `lesapo le robehile le tsoa`
- `open fracture`
- `rhambu ri tshovekile ri huma`
- `ḽitambo ḽo ṱhukhukana ḽi bva`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `lerapo le a bonala`
- `lerapo le tswa mo letlalong`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 14. `high_energy_mechanism`
*HIGH-ENERGY MECHANISM — car / fall from height / crush. All 11 languages.*

**English trigger phrases** (what the rule looks for in English):
- `car accident`
- `crush injury`
- `fell from height`
- `fell from ladder`
- `fell from roof`
- `geval van leer`
- `hit by car`
- `industrial accident`
- `ke oele le lereng`
- `ke wele le lereng`
- `motor accident`
- `motorcycle accident`
- `mvc`
- `ndiwe eluphahleni`
- `ndiwile phezulu`
- `ndo wa kha lere`
- `ndzi wile eka lere`
- `ngwele le lereng`
- `raakgery deur motor`
- `struck by vehicle`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `ke kgotlilwe ke koloi`
- `ke oele go tswa godimo`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 15. `burns_significant`
*BURNS SIGNIFICANT — burn + high-risk anatomy (face, airway, hands, large area). All 11 languages.*

**English trigger phrases** (what the rule looks for in English):
- `airways`
- `around neck`
- `asemweë`
- `breathing problems`
- `burn`
- `burned`
- `burnt`
- `buso`
- `diatla le matsogo`
- `face`
- `gesig`
- `go hema`
- `groot area`
- `hande en arms`
- `hands and arms`
- `ho hema`
- `indawo enkhulu`
- `indawo enkulu`
- `indzawo lenkhulu`
- `inhaled smoke`
- `intamo`
- `intsamo`
- `intsizi`
- `izandla nezingalo`
- `ku hefemula`
- `large area`
- `matsoho le maoto`
- `mavoko ni marhambu`
- `molaleng`
- `mosi o hemetsweng`
- `musi o hemelwago`
- `ndhawu yo kula`
- `nkolo`
- `o chesitse`
- `o fisitswe`
- `o tshiwa`
- `o tsholetsoe`
- `om nek`
- `rook ingeasem`
- `scald`
- `sebaka se segolo`
- `sebaka se seholo`
- `sefahlego`
- `sefahleho`
- `shango ḽihulu`
- `singed eyebrows`
- `singed hair`
- `tandla nemigalo`
- `tshifhaṱuwo`
- `u femba`
- `u hisile`
- `u pfile`
- `umqala`
- `ushisiwe`
- `ushiswe`
- `utshile`
- `utshisiwe`
- `vhunga ho funzeleaho`
- `xikandza`
- `zwanda na zwanḓa`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `o tšhutse`
- `sefatlhego`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 16. `burns`
*burns_xh*

**English trigger phrases** (what the rule looks for in English):
- `amanzi ashisayo`
- `isikhumba`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 17. `acute_abdomen`
*ss | ACUTE ABDOMEN — rigid/board-like abdomen, severe immovable pain. All 11 languages | (nso/tn/st/ts/ss/ve/nr pending native-speaker review).*

**English trigger phrases** (what the rule looks for in English):
- `buhlungu besisu lobukhulu`
- `ha ke tshwarelle mpa`
- `iintlungu zesisu ezinkulu`
- `kan nie maag raak nie`
- `khwiri a ri kombetelekiki`
- `lumbu ḽa sa fara`
- `mpa e sa swarega`
- `mpa ga e swarege`
- `rigid stomach`
- `severe stomach pain can\'t move`
- `stomach hard as a board`
- `worst stomach pain ever`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `bohloko jwa mpa bo bogolo thata`
- `mpa e thata jaaka lepolanka`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 18. `psychiatric_emergency_imminent`
*PSYCHIATRIC EMERGENCY IMMINENT — active self-harm risk or attempt in progress. All 11 languages.*

**English trigger phrases** (what the rule looks for in English):
- `about to hurt myself`
- `gesny aan polse`
- `going to kill myself`
- `ke ikgokile ka thapo`
- `ke ipofile ka thapo`
- `ke ithekeletse ka thapo`
- `ndiyazibulala ngoku`
- `ndizikhokele intambo`
- `ndizisikile ezihlakaleni`
- `ndo ḓirwa nga thambo`
- `ndzi tipfalile hi tintambo`
- `overdosed`
- `swallowed pills on purpose`
- `taking tablets now`
- `te veel pille gedrink`
- `took pills to die`
- `tried to cut wrists`
- `tried to hang`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `ke itshwaya gona jaanong`
- `ke nole dipilisi tse dintsi`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 19. `severe_hypoglycaemia`
*SEVERE HYPOGLYCAEMIA — low sugar + altered consciousness/behaviour. All 11 languages.*

**English trigger phrases** (what the rule looks for in English):
- `aggressief`
- `aggressive`
- `akaphenduli`
- `akavuki`
- `bjalwa bja dipilisi bo wele`
- `blood sugar crashed`
- `collapsed`
- `confused`
- `deurmekaar`
- `fitting`
- `glucose very low`
- `ha a arabe`
- `hypo`
- `iglucose iphansi`
- `not responding`
- `o a ratha`
- `o wa`
- `o wele`
- `sugar dropped`
- `sugar very low`
- `suiker het geval`
- `swigiri tsho wela`
- `swikiri swi wile`
- `tsoekere e wele`
- `u wile`
- `unconscious`
- `uquleke`
- `uyabanjwa`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `ga a arabe`
- `sukiri e kwa tlase thata`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 20. `preterm_labour`
*st*

**English trigger phrases** (what the rule looks for in English):
- `28 weeks`
- `30 weeks`
- `32 weeks`
- `34 weeks`
- `5 months`
- `6 months`
- `7 months`
- `bag of water broke`
- `contractions`
- `early`
- `labour`
- `not due yet`
- `pains`
- `pregnant`
- `premature`
- `swangari`
- `too early`
- `waters broke`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 21. `hiv_meningism`
*hiv_meningism*

**English trigger phrases** (what the rule looks for in English):
- `ache`
- `arv`
- `asthma`
- `asthma_inhaler_failure`
- `bohloko`
- `botlhoko`
- `cannot bend`
- `cant bend`
- `cant move`
- `eqinileyo`
- `fever`
- `fisa`
- `high temperature`
- `hiv disease`
- `hiv positive`
- `hiv+`
- `ho fisa`
- `hot`
- `hurts`
- `ibuhlungu`
- `icinile`
- `inhaler`
- `intamo`
- `intsamo`
- `molala`
- `mulala`
- `neck`
- `need more puffs`
- `nek`
- `nkulo`
- `not helping`
- `not working`
- `omela`
- `on arvs`
- `pain`
- `pump`
- `qinile`
- `rigid`
- `shivering`
- `sore`
- `stiff`
- `still struggling`
- `styf`
- `stywe`
- `taking arvs`
- `temperature`
- `thata`
- `tiyile`
- `ufudumele`
- `umkhuhlane`
- `umnqala`
- `uyashisa`
- `vava`
- `vuvha`
- `womelele`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### ORANGE 22. `acute_confusion_dm`
*── Afrikaans: confusion + diabetes (kept from original) ──*

**English trigger phrases** (what the rule looks for in English):
- `deurmekaar`
- `diabete`
- `maak nie sin`
- `suiker`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

### YELLOW discriminators

#### YELLOW 1. `severe_pain`
*nr | ── YELLOW DISCRIMINATORS ──*

**English trigger phrases** (what the rule looks for in English):
- `bohloko bo bogolo`
- `bohloko bo boholo`
- `botlhoko jo bogolo`
- `excruciating`
- `ke a lela ka botlhoko`
- `ke a lla ka bohloko`
- `ndi na vuvha vuhulu`
- `ndzi le vuhlungwini lebyi kuleke`
- `pain 10/10`
- `pain 8/10`
- `pain 9/10`
- `pain is 10`
- `pain is 8`
- `pain is 9`
- `pain too much`
- `screaming in pain`
- `seer baie`
- `severe pain`
- `unbearable pain`
- `vuhlungu lebyi kuleke`
- `vuvha vuhulu`
- `worst pain`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 2. `suicidal_ideation`
*suicidal_ideation*

**English trigger phrases** (what the rule looks for in English):
- `a ndzi sa lavi ku hanya`
- `a thi tsha ṱoḓa u tshila`
- `andisafuni kuphila`
- `cutting myself`
- `ga ke sa batle go tshela`
- `ga ke sa nyake go phela`
- `ha ke sa batle ho phela`
- `hurting myself`
- `ke batla go ipolaya`
- `ke batla ho ipolaya`
- `ke nyaka go ipolaya`
- `ndi ṱoḓa u ḓivhulaha`
- `ndzi lava ku tirhisa`
- `no reason to live`
- `self-harm`
- `suicidal`
- `suicide`
- `thinking of ending`
- `want to kill myself`
- `wil doodgaan`
- `wil nie meer leef`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 3. `abuse_assault`
*GBV / domestic violence / assault — YELLOW*

**English trigger phrases** (what the rule looks for in English):
- `abused`
- `assaulted`
- `attacked`
- `beaten badly`
- `child abuse`
- `domestic violence`
- `huishoudelike geweld`
- `husband beat me`
- `indoda yam indibethile`
- `ke betilwe`
- `ke otlilwe`
- `ke otloilwe`
- `monna wa ka o ntlhabile`
- `monna wa ka o ntshabile`
- `monna wa me o ntlhabile`
- `munna wanga o nrwa`
- `ndo rwiwa`
- `ndzi bitiwe`
- `nuna wa mina u ndzi bile`
- `partner hit me`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 4. `pyelonephritis`
*pyelonephritis*

**English trigger phrases** (what the rule looks for in English):
- `back pain`
- `bohloko emhamben`
- `bohloko mmogong`
- `bohloko mokokotlong`
- `burning urine`
- `chills`
- `fever`
- `frequency`
- `go sha fa ke ntsha metsi`
- `go sha ge ke ntsha meetse`
- `go swela ge ke ntsha meetse`
- `go tshwara go bohloko loko ke ntsha meetse`
- `ho bohloko ha ke ntsha metsi`
- `ho sha ha ke ntsha metsi`
- `kidney pain`
- `ku bohloko loko ndzi sila`
- `ku hisa loko ndzi sila manzi`
- `kusha emchamweni`
- `kushisa emchamweni`
- `kushisa umchamo`
- `loin pain`
- `mhamba wo bohloko`
- `mmogo o bohloko`
- `mokokotlo o bohloko`
- `murahu u rema`
- `muvhili wa murahu u rema`
- `pain when urinating`
- `pyn as ek urineer`
- `rigors`
- `rug is seer`
- `rugpyn`
- `shivering`
- `temperature`
- `u fhisa hune ndi a china`
- `u rema hune ndi a china`
- `urinary tract`
- `uti`
- `vomiting`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 5. `dka`
*dka*

**English trigger phrases** (what the rule looks for in English):
- `abdominal pain`
- `blood sugar very high`
- `braak`
- `breath smells sweet`
- `diabeet`
- `diabetes`
- `diabetic`
- `fruity breath`
- `glucose 20`
- `glucose over 15`
- `glucose over 20`
- `go hlanza`
- `go tlhaka`
- `gooi op`
- `ho hlantsa`
- `ishugela`
- `ishugela liphakeme kakhulu`
- `ishukela`
- `ishukela liphezulu kakhulu`
- `isisu sibuhlungu`
- `ke a hlantsa`
- `ke a hlanza`
- `ke a tlhaka`
- `ketone breath`
- `ku hlanza`
- `kuhlanza`
- `maag pyn`
- `mpa e bohloko`
- `mpa e botlhoko`
- `nauseous`
- `ndi a sema`
- `ndinesifo seswekile`
- `ndiyahlanza`
- `ndzayo wu vava`
- `ndzi a hlanza`
- `on insulin`
- `sisu sibuhlungu`
- `stomach pain`
- `sugar`
- `sugar very high`
- `suiker`
- `suiker baie hoog`
- `suikersiekte`
- `sukiri`
- `sukiri e kwa godimo thata`
- `swigiri`
- `swigiri dzi ḓiimisela ngopfu`
- `swikiri`
- `swikiri e phagameng kudu`
- `swikiri yi tlakukile ngopfu`
- `thumbu i na vuvha`
- `tsoekere`
- `tsoekere e phagameng haholo`
- `tswekere`
- `tswekere e kwa godimo`
- `u sema`
- `vomiting`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `bolwetse jwa sukiri`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 6. `tb_triad`
*tb_triad*

**English trigger phrases** (what the rule looks for in English):
- `cough`
- `fufulelwa bosigo`
- `gewig verloor`
- `gohlola`
- `hehela`
- `hoes`
- `hovelela`
- `khalutshela`
- `khohlela`
- `khomokile ncilo`
- `khwehlela`
- `laha vhuimo`
- `lahlegetšwe ke boima`
- `lahlehetse boima`
- `lahlekelwe isisindo`
- `lahlekelwe sisixa`
- `latlhile boima`
- `losing weight`
- `lost weight`
- `mavhungo usiku`
- `nagsweet`
- `nciphile isisindo`
- `ncokolele lisindo`
- `ndikhohla`
- `ndikhwehlela`
- `night sweats`
- `phulukane nesixa`
- `phwa bosigo`
- `sweat at night`
- `sweating at night`
- `sweet snags`
- `tswa marothodi bosigo`
- `tswa molapo bosiu`
- `weight loss`
- `xurha usiku`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 7. `possible_fracture`
*possible_fracture*

**English trigger phrases** (what the rule looks for in English):
- `crooked`
- `deformed`
- `fell`
- `fell down`
- `injury`
- `looks bent`
- `swollen and painful`
- `trauma`
- `twisted`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 8. `hypertensive_urgency`
*ts*

**English trigger phrases** (what the rule looks for in English):
- `blood pressure high`
- `blurred vision`
- `bp high`
- `confused`
- `dizzy`
- `duiselig`
- `headache`
- `high blood`
- `hlogo`
- `hloho`
- `hypertension`
- `isiyezi`
- `iyesuka`
- `kgatelelo ya madi e godimo`
- `kgatelelo ya madi e kwa godimo`
- `kgatello ya madi e phahameng`
- `nosebleed`
- `nsinya wa ngati wu tlakukile`
- `o a tekateka`
- `phuvhelo ya madi i phanda`
- `tlhogo`
- `u a tekateka`
- `u a ṱavhanya`
- `umfutho wegazi uphakeme`
- `umfutho wegazi uphezulu`
- `uxinzelelo lwegazi luphezulu`
- `uyesuka`
- `ṱhoho`

**Current Setswana keywords** (what the rule recognises in Setswana):
- `madi a godileng`

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 9. `hypertensive_urgency_reading`
*hypertensive_urgency_reading*

**English trigger phrases** (what the rule looks for in English):
- `bp 170`
- `bp 180`
- `bp 190`
- `bp 200`
- `dizzy`
- `headache`
- `vision`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 10. `appendicitis_pattern`
*st*

**English trigger phrases** (what the rule looks for in English):
- `appendix pain`
- `fever`
- `lower right pain`
- `pain right side stomach`
- `right abdo pain`
- `right lower quadrant`
- `vomiting`
- `worse when moving`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 11. `asthma_inhaler_failure`
*asthma_inhaler_failure*

**English trigger phrases** (what the rule looks for in English):
- `asthma`
- `inhaler`
- `need more puffs`
- `not helping`
- `not working`
- `pump`
- `still struggling`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 12. `meningism`
*meningism*

**English trigger phrases** (what the rule looks for in English):
- `fever`
- `intamo eqinileyo`
- `intamo ibuhlungu`
- `intamo iqinile`
- `intsamo ibuhlungu`
- `intsamo icinile`
- `molala o bohloko`
- `molala o botlhoko`
- `molala o thata`
- `mulala u na vuvha`
- `mulala wo omela`
- `neck is stiff`
- `neck pain`
- `neck stiff`
- `nek is styf`
- `nkulo wu tiyile`
- `nkulo wu vava`
- `stiff neck`
- `stywe nek`
- `umkhuhlane`
- `umnqala womelele`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 13. `hiv_fever`
*st | HIV + fever: risk-UPGRADE signal. Enforce YELLOW as a floor, preserve any | higher level the LLM already assigned (eval P16 caught this overwriting ORANGE).*

**English trigger phrases** (what the rule looks for in English):
- `arv`
- `fever`
- `high temperature`
- `hiv positive`
- `hiv+`
- `hiv_fever`
- `on arvs`
- `positive`
- `sick`
- `taking arvs`
- `temperature`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 14. `lower_abdo_missed_period`
*lower_abdo_missed_period*

**English trigger phrases** (what the rule looks for in English):
- `late period`
- `lower abdominal pain`
- `lower belly pain`
- `lower tummy pain`
- `missed period`
- `no period`
- `pelvic pain`
- `period late`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 15. `pregnancy_complication`
*pregnancy_complication*

**English trigger phrases** (what the rule looks for in English):
- `bleeding`
- `headache`
- `movement reduced`
- `no movement`
- `pain`
- `pregnant`
- `swangari`
- `swelling`
- `vision`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 16. `gi_bleeding`
*gi_bleeding*

**English trigger phrases** (what the rule looks for in English):
- `black tarry stool`
- `blood in poo`
- `blood in stool`
- `blood in vomit`
- `bloody diarrhoea`
- `ingati esitweni`
- `ingati iyaphumela ngemlomeni`
- `madi a tswa ka ganong`
- `madi a tšwa ka ganong`
- `madi leetšong`
- `madi mantšwing`
- `madi mo mantswing`
- `ngati enyangweni`
- `ngati yi huma hi nomo`
- `rectal bleeding`
- `throwing up blood`
- `vomiting blood`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 17. `deep_wound`
*deep_wound*

**English trigger phrases** (what the rule looks for in English):
- `animal bite`
- `bite wound`
- `deep cut`
- `deep wound`
- `glass in wound`
- `pouring`
- `puncture wound`
- `rusty nail`
- `spurting`
- `stab wound`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 18. `severe_dehydration_vulnerable`
*severe_dehydration_vulnerable*

**English trigger phrases** (what the rule looks for in English):
- `baby`
- `child`
- `diabetic`
- `diarrhoea and vomiting together`
- `elderly`
- `hiv`
- `infant`
- `mouth very dry`
- `no urine for hours`
- `not passed urine`
- `very dizzy`
- `vomiting everything`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 19. `eye_emergency`
*eye_emergency*

**English trigger phrases** (what the rule looks for in English):
- `blur suddenly`
- `chemical in eye`
- `eye injury`
- `hit in eye`
- `something in eye`
- `sudden`
- `suddenly`
- `vision`
- `went blind`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---

#### YELLOW 20. `testicular_torsion`
*testicular_torsion*

**English trigger phrases** (what the rule looks for in English):
- `scrotum pain`
- `severe`
- `sudden`
- `swollen testicle`
- `testicle pain`
- `testicular pain`

**Current Setswana keywords** (what the rule recognises in Setswana):
- **⚠️ NONE — please provide keywords for this symptom in Setswana**

**Status:** ☐ ✅ correct  ☐ ❌ wrong (fix below)  ☐ ➕ missing phrases to add

**Notes / corrections / additions:**

---


## Reviewer sign-off

**Reviewer name:** ________________________________

**Reviewer qualifications** (native speaker / clinical background / both):

**Date completed:** ________________

**Overall assessment** (tick one):
- ☐ All content is correct and natural. No changes needed.
- ☐ Most content is correct. Specific corrections/additions noted above.
- ☐ Substantial corrections needed. See notes above.

**Signature / confirmation:** ________________________________

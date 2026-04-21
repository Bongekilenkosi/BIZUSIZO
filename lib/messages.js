'use strict';
// All 11-language messages. msg() is the accessor — never read MESSAGES directly.
const MESSAGES = {

  // ==================== LANGUAGE MENU ====================
  language_menu: {
    // This is always shown in all languages at once
    _all: `Welcome to BIZUSIZO 🏥

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

Reply with the number.`
  },

  // ==================== LANGUAGE CONFIRMED ====================
  language_set: {
    en: '✅ Language set to *English*.\nType "language" anytime to change.',
    zu: '✅ Ulimi lusetelwe ku-*isiZulu*.\nBhala "ulimi" noma nini ukushintsha.',
    xh: '✅ Ulwimi lusetelwe kwisi-*Xhosa*.\nBhala "ulwimi" nanini na ukutshintsha.',
    af: '✅ Taal is gestel na *Afrikaans*.\nTik "taal" enige tyd om te verander.',
    nso: '✅ Polelo e beakantšwe go *Sepedi*.\nNgwala "polelo" nako efe go fetola.',
    tn: '✅ Puo e beilwe go *Setswana*.\nKwala "puo" nako nngwe go fetola.',
    st: '✅ Puo e behilwe ho *Sesotho*.\nNgola "puo" nako efe ho fetola.',
    ts: '✅ Ririmi ri vekiwile eka *Xitsonga*.\nTsala "ririmi" nkarhi wun\'wana ku cinca.',
    ss: '✅ Lulwimi lubekwe ku-*siSwati*.\nBhala "lulwimi" nanoma nini kushintja.',
    ve: '✅ Luambo lwo sedzwa kha *Tshivenda*.\nṄwalani "luambo" tshifhinga tshiṅwe u shanduka.',
    nr: '✅ Ilimi libekwe ku-*isiNdebele*.\nTlola "ilimi" nanini ukutjhentjha.'
  },

  // ==================== CONSENT PROMPT ====================
  // Based on PI-approved text. Fires immediately after language
  // selection, before any patient data is collected.
  consent: {
    en: `Welcome to BIZUSIZO. 🏥

This service helps you understand the urgency of your symptoms and guides you on where to seek care.

Important:
• This service provides health guidance only.
• It does not diagnose medical conditions.
• It does not replace a doctor or nurse.

We may ask questions about your symptoms to help guide you. Your responses may be securely stored to improve the safety and quality of the service. If you are referred to a clinic or hospital, your health information may be shared with the receiving facility to ensure you get the right care. Your information will be handled according to South African privacy laws (POPIA).

Do you consent to using this service?

1 — Yes, I consent and want to continue
2 — No, exit`,

    zu: `Siyakwamukela ku-BIZUSIZO. 🏥

Le sevisi ikusiza ukuqonda ukusheshiswa kwezimpawu zakho futhi ikuqondise ukuthi uzofuna usizo kuphi.

Okubalulekile:
• Le sevisi inikeza iseluleko sezempilo kuphela.
• Ayixilongi izifo.
• Ayisithathi indawo kudokotela noma kunesi.

Singabuza imibuzo mayelana nezimpawu zakho ukuze sikuqondise. Izimpendulo zakho zingagcinwa ngokuphepha ukuze kuthuthukiswe ukuphepha nokuphila kahle kwenkonzo. Uma uthunyelwa emtholampilo noma esibhedlela, ulwazi lwakho lwezempilo lungabelwa nesikhungo esikwamukelayo ukuze uthole ukunakekelwa okufanele. Ulwazi lwakho luzophathwa ngokwemithetho yobumfihlo yaseNingizimu Afrika (POPIA).

Uyavuma ukusebenzisa le nkonzo?

1 — Yebo, ngiyavuma futhi ngifuna ukuqhubeka
2 — Cha, phuma`,

    xh: `Wamkelekile ku-BIZUSIZO. 🏥

Le sevisi ikunceda ukuqonda ubungxamineko beempawu zakho kwaye ikuqondise apho unokufuna uncedo khona.

Okubalulekileyo:
• Le sevisi inika ingcebiso yezempilo kuphela.
• Ayixilongi iimeko zempilo.
• Ayithethi endaweni yagqirha okanye nomongikazi.

Singanikubuza imibuzo malunga neempawu zakho ukuze sikuqondise. Iimpendulo zakho zinganakanywa ngokokhuselo ukuphucula ukhuseleko nokuphila kakuhle kwenkonzo. Ukuba uthunyelwa ekliniki okanye esibhedlele, ulwazi lwakho lwezempilo lunokwabelana nendawo ekwamkelayo ukuqinisekisa ukuba ufumana unyango olufanelekileyo. Ulwazi lwakho luya kuphunyezwa ngokwemithetho yabucala yoMzantsi Afrika (POPIA).

Uyavuma ukusebenzisa le nkonzo?

1 — Ewe, ndiyavuma kwaye ndifuna ukuqhubeka
2 — Hayi, phuma`,

    af: `Welkom by BIZUSIZO. 🏥

Hierdie diens help jou om die dringendheid van jou simptome te verstaan en lei jou oor waar om sorg te soek.

Belangrik:
• Hierdie diens bied slegs gesondheidsgeleiding.
• Dit diagnoseer nie mediese toestande nie.
• Dit vervang nie 'n dokter of verpleegster nie.

Ons mag vrae oor jou simptome vra om jou te lei. Jou antwoorde kan veilig gestoor word om die veiligheid en kwaliteit van die diens te verbeter. As jy na 'n kliniek of hospitaal verwys word, kan jou gesondheidsinligting met die ontvangende fasiliteit gedeel word om te verseker dat jy die regte sorg ontvang. Jou inligting sal hanteer word volgens Suid-Afrikaanse privaatheidswette (POPIA).

Stem jy saam om hierdie diens te gebruik?

1 — Ja, ek stem saam en wil voortgaan
2 — Nee, verlaat`,

    nso: `O amogetšwe go BIZUSIZO. 🏥

Tirelo ye e go thuša go kwešiša go galefilega ga dika tša gago gomme e go laela gore o nyake thušo kae.

Go bohlokwa:
• Tirelo ye e fa maele a tša maphelo fela.
• Ga e nyakišiše malwetši a bongaka.
• Ga e nke legato la ngaka goba mooki.

Re ka go botšiša dipotšišo ka dika tša gago go go thuša go laela. Dikarabo tša gago di ka bolokwa ka bolokomedi go kaonafatša polokego le boleng bja tirelo. Ge o romelwa kliniking goba bookelong, tshedimošo ya gago ya tša maphelo e ka abelanwa le lefelo leo le go amogelago go netefatša gore o hwetša tlhokomelo ye e nepagetšego. Tshedimošo ya gago e tla hlokomelwa go ya ka melao ya sephiri ya Afrika Borwa (POPIA).

A o dumelela go šomiša tirelo ye?

1 — Ee, ke dumelela gomme ke nyaka go tšwela pele
2 — Aowa, tswa`,

    tn: `O amogelwa go BIZUSIZO. 🏥

Tirelo e e go thusa go tlhaloganya go tshoganyetso ga matshwao a gago mme e go kaelele gore o batla thuso kwa.

Go botlhokwa:
• Tirelo e e fa kgakololo ya boitekanelo fela.
• Ga e tlhatlhobe maemo a kalafi.
• Ga e nke legato la ngaka kgotsa mooki.

Re ka go botsa dipotso ka matshwao a gago go go kaelela. Dikarabo tsa gago di ka bolokelwa ka polokeho go tokafatsa polokego le boleng jwa tirelo. Fa o romelwa kliniki kgotsa bookelong, tshedimosetso ya gago ya boitekanelo e ka abelanwa le lefelo le le go amogelang go netefatsa gore o bona tlhokomelo e e siameng. Tshedimosetso ya gago e tla tshwariwa go ya ka melao ya sephiri ya Afrika Borwa (POPIA).

A o dumela go dirisa tirelo e?

1 — Ee, ke a dumela mme ke batla go tswelela
2 — Nnyaa, tswa`,

    st: `O amohelehile ho BIZUSIZO. 🏥

Tshebeletso ena e o thusa ho utlwisisa ho tshohanyetso ha matshwao a hao mme e o laele hore o batla thuso kae.

Ho bohlokwa:
• Tshebeletso ena e fana ka tataiso ya bophelo fela.
• Ha e hlahlobe maemo a bongaka.
• Ha e nke sebaka sa ngaka kapa mooki.

Re ka o botsa dipotso ka matshwao a hao ho o laela. Dikarabo tsa hao di ka bolokwa ka polokoho ho kaonafatsa polokoho le boleng ba tshebeletso. Haeba o romelwa tliliniking kapa sepetlele, tlhahisoleseding ya hao ya bophelo e ka arolelana le sebaka se o amohelwang ho netefatsa hore o fumana tlhokomelo e nepahetseng. Tlhahisoleseding ya hao e tla tshwarwa ho ya ka melao ya sephiri ya Afrika Borwa (POPIA).

Na o dumela ho sebedisa tshebeletso ena?

1 — E, ke a dumela mme ke batla ho tswela pele
2 — Tjhe, tswa`,

    ts: `U amukelekile eka BIZUSIZO. 🏥

Vukorhokeri lebyi byi ku pfuna ku twisisa ku tshikelela ka swikombiso swa wena naswona byi ku laela laha u lava pfuno kona.

Swi-bohlokwa:
• Vukorhokeri lebyi byi nyika switsundzuxo swa rihanyo fela.
• A byi kambeli maemo ya vutshwari.
• A byi nki xiyimo xa dokodela kumbe nesi.

Hi nga ku vutisa swivutiso mayelana na swikombiso swa wena ku ku laela. Tivindlo ta wena ti nga hlayisiwa hi ku hlayiseka ku antswisa polokelo na boleng bya vukorhokeri. Loko u rhumeriwa ekliniki kumbe exibedlhele, vuxokoxoko bya wena bya rihanyo byi nga avelana na ndhawu leyi ku amukelaka ku tiyisisa leswaku u kuma vukorhokeri lebyi faneleke. Vuxokoxoko bya wena byi ta tirhisiwa hi ku ya hi milawu ya sephiri ya Afrika Borwa (POPIA).

Xana wa pfumela ku tirhisa vukorhokeri lebyi?

1 — Ina, ndza pfumela naswona ndzi lava ku ya emahlweni
2 — Ee-ee, huma`,

    ss: `Wemukelekile ku-BIZUSIZO. 🏥

Lesevisi likusita kucondza kusheshiswa kwetimphawu takho futsi likunqophisa lapho ungacinga lusito khona.

Lobubalulekile:
• Lesevisi liniketa teluleko yempilo kuphela.
• Alihlongi timo tetemphilo.
• Alintsintsi indawo yedokotela noma yanesi.

Singakubuza imibuzo mayelana netimphawu takho kukusita kukucondzisa. Tiphendvulo takho tingagcinwa ngokokhuselo kutfutfukisa kuphepha nekusebenta kahle kwalesevisi. Nawutfunyelwa emtfolamphilo noma esibhedlela, lwati lwakho lwempilo lungabelwa nendzawo lekwemukelako kutsi utfole lusito lolufanele. Lwati lwakho luyawuphathwa ngemitsetfo yabucala yaseNingizimu Afrika (POPIA).

Uyavuma kusebentisa lesevisi?

1 — Yebo, ngiyavuma futsi ngifuna kuchubeka
2 — Cha, phuma`,

    ve: `Vho ṱanganedzwa kha BIZUSIZO. 🏥

Tshumelo iyi i ni thusa u pfesesa ya u hatlisa ha zwiga zwaṋu nahone i ni laedza fhethu hune na nga wana thuso hone.

Zwo fhambana:
• Tshumelo iyi i ṋea vhulivhisi ha mutakalo fhedzi.
• A i ṱoḓisisi maimo a vhutshilo.
• A i ntshanduki ya dokotela kana nese.

Ri nga ni vhudzisa mbudziso dza zwiga zwaṋu u ni ita uri ni kone u wana tshiimo tshine na ṱoḓa. Mafhungo aṋu a fhindulaho a nga vhulunga nga u tsireledzea u khwinifhadza polokelo na ndeme ya tshumelo. Arali ni tshi rumelwa kha kiliniki kana sibadela, mafhungo aṋu a mutakalo a nga abelwa na fhethu hune ha ni ṱanganedza u itela uri ni wane tshumelo ye ya tea. Mafhungo aṋu a ḓo shumiswa nga u ya nga milayo ya phumvulatshifhinga ya Afrika Tshipembe (POPIA).

Ni tenda u shumisa tshumelo iyi?

1 — Ee, ndi a tenda naṋe ndi ṱoḓa u bveledzea
2 — Hai, bva`,

    nr: `Wamukelekile ku-BIZUSIZO. 🏥

Isevisi le likosita ukuqonda ukusheshiswa kweiimpawu zakho futhi likunqophisa lapho ungatjheja usizo khona.

Okubalulekile:
• Isevisi le linikela isinqophiso sezempilo kuphela.
• Alihlongi iimeko zemphilo.
• Alintsintsi indawo yedokotela noma yanesi.

Singakubuza imibuzo mayelana neiimpawu zakho ukuze sikuqondise. Iimpendulo zakho zingagcinwa ngokuphepha ukuze kutfutfukiswe ukuphepha nokusebenza kuhle kwesevisi. Nawutfunyelwa ekliniki noma esibhedlela, ulwazi lwakho lwezempilo lungabelwa nesikhungo esikwemukelako ukuze uthole ukunakwa okufanele. Ulwazi lwakho luyawuphathwa ngemithetho yabucala yeNingizimu Afrika (POPIA).

Uyavuma ukusebenzisa isevisi le?

1 — Iye, ngiyavuma futhi ngifuna ukuqhubeka
2 — Awa, phuma`,

    nso: `O amogelwa go BIZUSIZO. 🏥

Tirelo ye e go thuša go kwešiša go tšhoganetša ga matšoenyego a gago mme e go kaele gore o nyaka thušo kae.

Go bohlokwa:
• Tirelo ye e fa tataišo ya boitekanelo fela.
• Ha e hlahlobe maemo a bongaka.
• Ha e nke sebaka sa ngaka goba mooki.

Re ka botšiša dipotšišo ka matšoenyego a gago go go thuša. Dikarabo tša gago di ka bolokwa ka polokeho go kaonafatša polokego le boleng bja tirelo. Tšhedimosetšo ya gago e tla tšhwarwa go ya ka melao ya sephiri ya Afrika Borwa (POPIA).

A o dumela go šomiša tirelo ye?

1 — Ee, ke a dumela mme ke nyaka go tšwela pele
2 — Nnyaa, tswa`,

    tn: `O amogelwa go BIZUSIZO. 🏥

Tirelo eno e go thusa go tlhaloganya go tshoganyetsa ga matshwenyego a gago mme e go kaele gore o batla thuso kae.

Go botlhokwa:
• Tirelo eno e fa tataiso ya boitekanelo fela.
• Ga e hlahlobe maemo a bongaka.
• Ga e nke sebaka sa ngaka kgotsa mooki.

Re ka botsa dipotso ka matshwenyego a gago go go thusa. Dikarabo tsa gago di ka bolokelwa ka polokeho go tokafatsa polokego le boleng jwa tirelo. Tshedimosetso ya gago e tla tshwariwa go ya ka melao ya sephiri ya Afrika Borwa (POPIA).

A o dumela go dirisa tirelo eno?

1 — Ee, ke a dumela mme ke batla go tswelela
2 — Nnyaa, tswa`,
  },

  // ==================== CONSENT RESPONSES ====================
  consent_yes: {
    en: '✅ Thank you. Let\'s get you to the right care.',
    zu: '✅ Siyabonga. Ake sikuqondise kunakekelo okulungile.',
    xh: '✅ Enkosi. Masikuqondise kulo nyango.',
    af: '✅ Dankie. Kom ons lei jou na die regte sorg.',
    nso: '✅ Re a leboga. A re go laele go tlhokomelo ye e lokilego.',
    tn: '✅ Re a leboga. Re go kaelele go tlhokafalo e e siameng.',
    st: '✅ Re a leboha. Ha re o laele ho tlhokomelo e nepahetseng.',
    ts: '✅ Hi khensa. A hi ku laela eka nhlamulo leyo fanelaka.',
    ss: '✅ Siyabonga. Ake sikucondzise ekunakekelweni lokufanele.',
    ve: '✅ Ri a livhuwa. A ri ni laedze kha ndangulo yo teaho.',
    nr: '✅ Siyathokoza. Ake sikuqondise ekunakekelweni okufanele.'
  },

  consent_no: {
    en: 'That\'s okay. Your session has ended and no information has been stored.\n\nIf you change your mind or need help in future, send "Hi" to start again. You can also visit your nearest clinic directly.\n\nTake care. 🙏',
    zu: 'Kulungile. Isikhathi sakho siphelile futhi akukho ulwazi olugciniwe.\n\nUma uguqula umqondo noma udinga usizo esikhathini esizayo, thumela "Hi" ukuqala futhi. Ungavakashela umtholampilo oseduze nawe.\n\nZinakekele. 🙏',
    xh: 'Kulungile. Iseshoni yakho iphelile kwaye akukho lwazi lugciniwayo.\n\nUkuba utshintshe ingqondo okanye udinga uncedo kwixesha elizayo, thumela "Hi" ukuqala kwakhona. Ungatyelela ikliniki yakho ekufutshane nawe.\n\nZinakekele. 🙏',
    af: 'Dit is goed. Jou sessie het geëindig en geen inligting is gestoor nie.\n\nAs jy van plan verander of in die toekoms hulp nodig het, stuur "Hi" om weer te begin. Jy kan ook jou naaste kliniek direk besoek.\n\nSorg vir jouself. 🙏',
    nso: 'Go lokile. Sešene ya gago e fedile gomme ga go na tshedimošo ye e bolokwago.\n\nGe o fetola mogopolo goba o hloka thušo ka nako ye e tlago, romela "Hi" go thoma gape. O ka etela kliniki ya gago ya kgauswi.\n\nIpholose. 🙏',
    tn: 'Go siame. Seshene ya gago e fedile mme ga go na tshedimosetso e e bolokilweng.\n\nFa o fetola mogopolo kgotsa o tlhoka thuso mo isagong, romela "Hi" go simolola gape. O ka etela kliniki ya gago ya gaufi.\n\nInatale. 🙏',
    st: 'Ho lokile. Seshene ya hao e fedile mme ha ho na tlhahisoleseding e bolokilweng.\n\nHaeba o fetola monahano kapa o hloka thuso ka nako e tlang, romela "Hi" ho qala hape. O ka etela kliniki ya hao e haufi.\n\nItlhokomele. 🙏',
    ts: 'Swi lava. Sesheni ya wena yi herile naswona a ku na vuxokoxoko lebyi hlayisiweke.\n\nLoko u cinca mianakanyo kumbe u lava pfuno enkarhini wo tlanga, rhumela "Hi" ku sungula nakambe. U nga endzela kliniki ya wena ya kusuhi.\n\nTihlayisa. 🙏',
    ss: 'Kulungile. Seshini yakho iphelile futsi akukho lwati lolugciniwe.\n\nNawugucula umcondvo noma udzinga lusito ngesikhatsi lesizako, tfumela "Hi" kucala futsi. Ungavakashela umtfolamphilo losedvute nawe.\n\nTinakekele. 🙏',
    ve: 'Zwo luga. Sesheni yaṋu yo fhela nahone a hu na mafhungo o vhulungwaho.\n\nArali na shanduka muhumbulo kana na ṱoḓa thuso tshifhinga tshi tsha u ḓa, rumelani "Hi" u thoma hafhu. Ni nga dalela kiliniki yaṋu ya tsini.\n\nDzulani zwavhuḓi. 🙏',
    nr: 'Kulungile. Iseshini yakho iphelile futhi akukho lwazi olugciniwe.\n\nNawutjhentjha umkhumbulo noma udzinga usizo ngeskhathi esizokhona, thumela "Hi" ukuqala godu. Ungavakatjhela ikliniki yakho eseduze nawe.\n\nZinakekele. 🙏'
  },

  // ==================== SYMPTOM CATEGORY MENU ====================
  category_menu: {
    en: `What is your main problem today?

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
15. 🔬 Health screening (HIV, BP, diabetes)`,

    zu: `Yini inkinga yakho enkulu namuhla?

1. 🫁 Izinkinga zokuphefumula / Ubuhlungu besifuba
2. 🤕 Ukulimala kwekhanda / Ikhanda elibuhlungu
3. 🤰 Okuphathelene nokukhulelwa
4. 🩸 Ukopha / Inxeba
5. 🤒 Imfiva / Umkhuhlane / Ukukhwehlela
6. 🤢 Isisu / Ukuhlanza
7. 👶 Ukugula kwengane
8. 💊 Umuthi / Isifo esingamahlalakhona
9. 🦴 Ithambo / Amalunga / Ubuhlungu bomhlane
10. 🧠 Impilo yengqondo
11. 🤧 I-allergy / Ukuvuvukala kwesikhumba
12. ✏️ Okunye — bhala izimpawu zakho
13. 👤 Khuluma nomuntu
14. 🩺 Impilo yabesifazane (ukuhlela umndeni)
15. 🔬 Ukuhlolwa kwempilo (HIV, BP, ushukela)`,

    xh: `Yintoni ingxaki yakho enkulu namhlanje?

1. 🫁 Ukuphefumla / Intlungu yesifuba
2. 🤕 Ukonzakala kwentloko / Intloko ebuhlungu
3. 🤰 Okuphathelene nokukhulelwa
4. 🩸 Ukopha / Inxeba
5. 🤒 Ifiva / Umkhuhlane / Ukukhohlela
6. 🤢 Isisu / Ukugabha
7. 👶 Ukugula komntwana
8. 💊 Amayeza / Isifo esinganyangekiyo
9. 🦴 Ithambo / Amalungu / Umqolo obuhlungu
10. 🧠 Impilo yengqondo
11. 🤧 I-aloji / Ukuvuvukala kwesikhumba
12. ✏️ Okunye — bhala iimpawu zakho
13. 👤 Thetha nomntu
14. 🩺 Impilo yabafazi (ukucwangcisa usapho)
15. 🔬 Ukuhlolwa kwempilo (HIV, BP, iswekile)`,

    af: `Wat is jou hoofprobleem vandag?

1. 🫁 Asemhaling / Borspyn
2. 🤕 Kopbesering / Hoofpyn
3. 🤰 Swangerskap verwant
4. 🩸 Bloeding / Wond
5. 🤒 Koors / Griep / Hoes
6. 🤢 Maag / Braking
7. 👶 Kindergesiekte
8. 💊 Medikasie / Chroniese siekte
9. 🦴 Been / Gewrig / Rugpyn
10. 🧠 Geestesgesondheid
11. 🤧 Allergie / Uitslag
12. ✏️ Ander — tik jou simptome
13. 👤 Praat met 'n mens
14. 🩺 Vrouegesondheid (gesinsbeplanning)
15. 🔬 Gesondheidstoetse (MIV, BP, suiker)`,

    nso: `Bothata bja gago bjo bogolo ke eng lehono?

1. 🫁 Go hema / Bohloko bja sehuba
2. 🤕 Kotsi ya hlogo / Hlogo e bohloko
3. 🤰 Tša moimana
4. 🩸 Go tšwa madi / Ntho
5. 🤒 Fifare / Mokgathala / Go gohlola
6. 🤢 Mpa / Go hlatša
7. 👶 Bolwetši bja ngwana
8. 💊 Dihlare / Bolwetši bja go se fole
9. 🦴 Lesapo / Makopano / Bohloko bja mokokotlo
10. 🧠 Maphelo a monagano
11. 🤧 Aletshe / Dišo
12. ✏️ Tše dingwe — ngwala dika tša gago
13. 👤 Bolela le motho
14. 🩺 Maphelo a basadi (peakanyo ya lapa)
15. 🔬 Diteko tša maphelo (HIV, BP, swikiri)`,

    tn: `Bothata jwa gago jo bogolo ke eng gompieno?

1. 🫁 Go hema / Botlhoko jwa sehuba
2. 🤕 Kotsi ya tlhogo / Tlhogo e botlhoko
3. 🤰 Tsa boimana
4. 🩸 Go tswa madi / Ntho
5. 🤒 Letshoroma / Mokgathala / Go gotlhola
6. 🤢 Mpa / Go tlhatsa
7. 👶 Bolwetse jwa ngwana
8. 💊 Melemo / Bolwetse jo bo sa foleng
9. 🦴 Lesapo / Dikopano / Botlhoko jwa mokwatla
10. 🧠 Boitekanelo jwa tlhaloganyo
11. 🤧 Aletshe / Diso
12. ✏️ Tse dingwe — kwala matshwao a gago
13. 👤 Bua le motho
14. 🩺 Boitekanelo jwa basadi (peakanyo ya lelapa)
15. 🔬 Diteko tsa boitekanelo (HIV, BP, sukiri)`,

    st: `Bothata ba hao bo boholo ke eng kajeno?

1. 🫁 Ho hema / Bohloko ba sefuba
2. 🤕 Kotsi ya hlooho / Hlooho e bohloko
3. 🤰 Tsa boima
4. 🩸 Ho tswa madi / Leqeba
5. 🤒 Feberu / Mokhatlo / Ho hohlola
6. 🤢 Mala / Ho hlatsa
7. 👶 Bokudi ba ngwana
8. 💊 Meriana / Bokudi bo sa foleng
9. 🦴 Lesapo / Masapo / Bohloko ba mokokotlo
10. 🧠 Bophelo ba kelello
11. 🤧 Alereji / Ho ruruha ha letlalo
12. ✏️ Tse ding — ngola matshwao a hao
13. 👤 Bua le motho
14. 🩺 Bophelo ba basadi (ho rala lelapa)
15. 🔬 Diteko tsa bophelo (HIV, BP, tsoekere)`,

    ts: `Xiphiqo xa wena lexikulu i yini namuntlha?

1. 🫁 Ku hefemula / Ku vava ka xifuva
2. 🤕 Khombo ra nhloko / Nhloko yo vava
3. 🤰 Swa vukatana
4. 🩸 Ku hangalaka ka ngati / Ndzovo
5. 🤒 Fifera / Mukhuhlwana / Ku khohola
6. 🤢 Xisu / Ku hlanza
7. 👶 Vuvabyi bya n'wana
8. 💊 Murhi / Vuvabyi byo tshama
9. 🦴 Rirambu / Malungu / Ku vava ka nkongo
10. 🧠 Rihanyo ra mianakanyo
11. 🤧 Aletshe / Ku pfimba ka dzovo
12. ✏️ Swin'wana — tsala swikombiso swa wena
13. 👤 Vulavula na munhu
14. 🩺 Rihanyo ra vavasati (ku pulana ndyangu)
15. 🔬 Mavonelo ya rihanyo (HIV, BP, swikiri)`,

    ss: `Yini inkinga yakho lenkhulu lamuhla?

1. 🫁 Kuphefumula / Kuva buhlungu esifubeni
2. 🤕 Kulimala kwenhloko / Inhloko lebuhlungu
3. 🤰 Lokuphatselene nekukhulelwa
4. 🩸 Kopha / Intsandza
5. 🤒 Imfiva / Umkhuhlane / Kukhwehlela
6. 🤢 Sisu / Kuhlanta
7. 👶 Kugula kwemntfwana
8. 💊 Umutsi / Sifo lesingapheli
9. 🦴 Litsambo / Kuva buhlungu kwemhlane
10. 🧠 Imphilo yengcondvo
11. 🤧 I-aletshe / Kudumba kwesikhunba
12. ✏️ Lokunye — bhala timphawu takho
13. 👤 Khuluma nemuntfu
14. 🩺 Imphilo yebafati (kuhlela umndeni)
15. 🔬 Kuhlolwa kwemphilo (HIV, BP, shukela)`,

    ve: `Thaidzo yaṋu khulwane ndi ifhio ṋamusi?

1. 🫁 U femba / Vhuṱungu ha tshifuva
2. 🤕 Khombo ya ṱhoho / Ṱhoho i a vhavha
3. 🤰 Zwa u ṱhimana
4. 🩸 U bva malofha / Mbonzhe
5. 🤒 Fivhara / Mukhuhlwane / U kosola
6. 🤢 Thumbu / U tanza
7. 👶 Vhulwadze ha ṅwana
8. 💊 Mushonga / Vhulwadze vhu sa folaho
9. 🦴 Thambo / Mahungu / Vhuṱungu ha musana
10. 🧠 Mutakalo wa muhumbulo
11. 🤧 Aletshe / U zwimba ha lukanda
12. ✏️ Zwiṅwe — ṅwalani zwiga zwaṋu
13. 👤 Ambelani na muthu
14. 🩺 Mutakalo wa vhafumakadzi (u dzudzanya muṱa)
15. 🔬 Ndingo dza mutakalo (HIV, BP, swigiri)`,

    nr: `Yini ikinga yakho ekulu namhlanje?

1. 🫁 Ukuphefumula / Ubuhlungu besifuba
2. 🤕 Ukulimala kwehloko / Ihloko ebuhlungu
3. 🤰 Okuphathelene nokukhulelwa
4. 🩸 Ukophisa / Inxeba
5. 🤒 Ifiva / Umkhuhlane / Ukukhwehlela
6. 🤢 Isisu / Ukuhlanza
7. 👶 Ukugula komntwana
8. 💊 Umuthi / Isifo esingapheliko
9. 🦴 Ithambo / Amalunga / Ubuhlungu bomhlana
10. 🧠 Ipilo yomkhumbulo
11. 🤧 I-aletshe / Ukuvuvukala kwesikhumba
12. ✏️ Okhunye — tlola iimpawu zakho
13. 👤 Khuluma nomuntu
14. 🩺 Ipilo yabafazi (ukuhlela umndeni)
15. 🔬 Ukuhlolwa kwepilo (HIV, BP, iswigiri)`,

    nso: `Ke eng bothata bja gago bo bogolo lehono?

1. 🫁 Mathata a go hema / Bohloko bja sehuba
2. 🤕 Go gobala hlogo / Hlogo e bohloko
3. 🤰 Go hlanama
4. 🩸 Go opha / Ntho
5. 🤒 Fiefo / Mokakatšo / Go kgohlela
6. 🤢 Mpa / Go hlaba mpa
7. 👶 Bolwetši bja ngwana
8. 💊 Molemo / Bolwetši bjo bo sa fele
9. 🦴 Lesapo / Letšwele / Mokokotlo
10. 🧠 Boitekanelo bja mogopolo
11. 🤧 Aleji / Letšatšikgwebu
12. ✏️ Tše dingwe — ngwala matšoenyego a gago
13. 👤 Bolela le motho
14. 🩺 Boitekanelo bja basadi (go rulaganya lapa)
15. 🔬 Tlhahlobo ya boitekanelo (HIV, BP, tšhukere)`,

    tn: `Ke eng bothata jwa gago jo bogolo gompieno?

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
15. 🔬 Tlhahlobo ya boitekanelo (HIV, BP, tshukere)`,
  },

  // ==================== TRIAGE RESULTS ====================
  triage_red: {
    en: '🔴 *EMERGENCY*\n\nCall *10177* for an ambulance NOW.\nIf private: ER24 *084 124*.\n\n⚠️ *Do NOT wait for the ambulance* — go to your nearest hospital emergency unit immediately. Ask someone to drive you or take a taxi.',
    zu: '🔴 *ISIMO ESIPHUTHUMAYO*\n\nShaya *10177* ucele i-ambulensi MANJE.\nUma usebenzisa ezimfihlo: ER24 *084 124*.\n\n⚠️ *UNGALINDI i-ambulensi* — yana esibhedlela esiseduze nawe ngokushesha. Cela umuntu akushayele noma uthathe itekisi.',
    xh: '🔴 *INGXAKEKO ENGXAMISEKILEYO*\n\nTsalela *10177* ucele i-ambulensi NGOKU.\nYabucala: ER24 *084 124*.\n\n⚠️ *MUSA UKULINDA i-ambulensi* — yiya esibhedlele esikufutshane nawe ngokukhawuleza. Cela umntu akuqhubele okanye uthathe iteksi.',
    af: '🔴 *NOODGEVAL*\n\nBel *10177* vir \'n ambulans NOU.\nPrivaat: ER24 *084 124*.\n\n⚠️ *MOENIE WAG vir die ambulans nie* — gaan na jou naaste hospitaal noodafdeling dadelik. Vra iemand om jou te ry of neem \'n taxi.',
    nso: '🔴 *TŠHOGANETŠO*\n\nLeletša *10177* go kgopela ambulense BJALE.\nPraebete: ER24 *084 124*.\n\n⚠️ *O SE KE WA EMA ambulense* — yaa sepetleleng sa kgauswi ka pela. Kgopela motho go go išetša goba o tšee thekisi.',
    tn: '🔴 *TSHOGANYETSO*\n\nLeletsa *10177* go kopa ambulense JAANONG.\nPraebete: ER24 *084 124*.\n\n⚠️ *O SE KA WA EMA ambulense* — ya bookelong jo bo gaufi ka bonako. Kopa motho go go isa kgotsa o tseye thekisi.',
    st: '🔴 *TSHOHANYETSO*\n\nLetsetsa *10177* ho kopa ambulense HONA JOALE.\nPraebete: ER24 *084 124*.\n\n⚠️ *O SE KE OA EMA ambulense* — eya sepetlele se haufi kapele. Kopa motho ho o isa kapa o nke thekisi.',
    ts: '🔴 *XIHATLA*\n\nRingela *10177* ku kombela ambulense SWESWI.\nPrayivhete: ER24 *084 124*.\n\n⚠️ *U NGA YIMI ambulense* — famba u ya exibedlhele xa kusuhi hi ku hatlisa. Kombela munhu ku ku yisa kumbe u teka thekisi.',
    ss: '🔴 *LOKUSHESHISAKO*\n\nShayela *10177* ucele i-ambulensi NYALO.\nYangasese: ER24 *084 124*.\n\n⚠️ *UNGALINDZI i-ambulensi* — hamba uye esibhedlela leseduze masinyane. Cela umuntfu akushayele noma utfatse lithekisi.',
    ve: '🔴 *TSHOGANETSO*\n\nFounelani *10177* u humbela ambulense ZWINO.\nPuraivete: ER24 *084 124*.\n\n⚠️ *NI SONGO LINDELA ambulense* — iyani sibadela tshi re tsini nga u ṱavhanya. Humbelani muthu u ni fhira kana ni dzhie thekisi.',
    nr: '🔴 *ISIMO ESIPHUTHUMAKO*\n\nRingela *10177* ubawa i-ambulensi NJE.\nYefihlo: ER24 *084 124*.\n\n⚠️ *UNGALINDELI i-ambulensi* — iya esibhedlela esiseduze ngokurhaba. Bawa umuntu akuse namkha uthathe ithekisi.'
  },

  triage_orange: {
    en: '🟠 *VERY URGENT*\nYou need care quickly.',
    zu: '🟠 *KUPHUTHUMA KAKHULU*\nUdinga usizo ngokushesha.',
    xh: '🟠 *KUNGXAMISEKE KAKHULU*\nUfuna inkathalo ngokukhawuleza.',
    af: '🟠 *BAIE DRINGEND*\nJy het vinnig sorg nodig.',
    nso: '🟠 *GO ŠUTIŠWA KUDU*\nO hloka tlhokomelo ka pela.',
    tn: '🟠 *GO TSHOGANYETSO THATA*\nO tlhoka tlhokomelo ka bonako.',
    st: '🟠 *HO POTLAKILE HAHOLO*\nO hloka tlhokomelo kapele.',
    ts: '🟠 *SWI HATLISA NGOPFU*\nU lava vukorhokeri hi ku hatlisa.',
    ss: '🟠 *KUSHESHISA KAKHULU*\nUdzinga lusito masinyane.',
    ve: '🟠 *ZWO ṰOḒEA VHUKUMA*\nNi ṱoḓa tshumelo nga u ṱavhanya.',
    nr: '🟠 *KUPHUTHUMA KHULU*\nUdinga lusizo ngokurhaba.'
  },

  // Low-confidence clarification — ask patient for more detail before routing
  clarify_symptoms: {
    en: 'I need a little more information to assess your symptoms accurately.\n\nCould you describe what you are feeling in more detail?\n\n- Where exactly is the pain or discomfort?\n- How long have you had this symptom?\n- Is it getting worse, better, or staying the same?',
    zu: 'Ngidinga ulwazi olwengeziwe ukuhlola izimpawu zakho ngokunembe.\n\nNgabe ungachaza okuzizwa kwakho kabanzi?\n\n- Kuphi ngqo ubuhlungu noma ukungaphatheki kahle?\n- Usube nalesi siphawu isikhathi esingakanani?\n- Siba sibi, siba ngcono, noma sihlala njalo?',
    xh: 'Ndifuna ulwazi olungakumbi ukuhlola iimpawu zakho ngokuchanekileyo.\n\nNgaba ungachaza oko uziva kuko ngokunzulu?\n\n- Uphi ngqo ubuhlungu okanye ukungakhululeki?\n- Ube nale mpawu ixesha elingakanani?\n- Iyonakala, iyalunga, okanye ihlala njalo?',
    af: 'Ek benodig nog inligting om jou simptome akkuraat te assesseer.\n\nKan jy beskryf hoe jy voel in meer besonderhede?\n\n- Waar presies is die pyn of ongemak?\n- Hoe lank het jy hierdie simptoom al?\n- Word dit erger, beter, of bly dit dieselfde?',
    nso: 'Ke hloka tshedimošo ye nngwe go sekaseka dika tša gago ka nepo.\n\nO ka hlaloša se o ikutlwago ka botlalo?\n\n- Ke kae gabotse bohloko goba go se phele gabotse?\n- O na le seeme se nako ye kae?\n- Se mpefala, se kaonafala, goba se dula bjalo?',
    tn: 'Ke tlhoka tshedimosetso e nngwe go sekaseka matshwao a gago ka nepagalo.\n\nA o ka tlhalosa se o ikutlwang ka botlalo?\n\n- Ke kae go nepa botlhoko kgotsa go se itekanele?\n- O na le seeme se nako e kae?\n- Se a mpefala, se a tokafala, kgotsa se dula jalo?',
    st: 'Ke hloka tlhahisoleseding e nngwe ho sekaseka matshwao a hao ka nepo.\n\nNA o ka hlalosa se o ikutlwang ka botlalo?\n\n- Ke hokae hantle bohloko kapa ho se phele hantle?\n- O na le seeme sena nako e kae?\n- Se mpefala, se kaohana, kapa se dula jwalo?',
    ts: "Ndzi lava vuxokoxoko byin'wana ku kambela swikombiso swa wena hi ku twisiseka.\n\nA wu nga hlamusela leswi wu twang hi vuxokoxoko?\n\n- Hi kwihi ku olova nhlokometo kumbe ku pfumaleka kahle?\n- U na xikombo lexi nkarhi wa xikan'we?\n- Xi tika, xi lulama, kumbe xi dula njalo?",
    ss: 'Ngidzinga lwati lolunye kuhlola timphawu takho ngebuciko.\n\nUngachaza lokuzwako ngemininingwane?\n\n- Kuphi ngempela buhlungu noma lokungaphili kahle?\n- Ubunesimpawu lesi sikhashana lesingakanani?\n- Siba sibi, siba ngcono, noma sihlala njalo?',
    ve: 'Ndi ṱoḓa mafhungo a mangwe u sedzulusa zwiga zwaṋu nga vhuhumisaho.\n\nNi nga hlamuselani zwine na zwi huwelela nga vhuḓalo?\n\n- Ndi fhea hani vhukuma vuvha kana u sa zwi fari zwavhuḓi?\n- Ni na tshiga tshi re nṱha tshifhinga tsha zwenyi?\n- Tshi khou ṱavhanya, tshi khou fhira, kana tshi ima zwenye?',
    nr: 'Ngidinga ulwazi olunengi ukuhlola iimpawu zakho ngokunembe.\n\nUngachaza okuzizwa kwakho kabanzi?\n\n- Kuphi ngqo ubuhlungu namkha ukungaphatheki kahle?\n- Ubunale isimpawu lesi isikhathi esingakanani?\n- Siba sibi, siba ngcono, namkha sihlala njalo?'
  },

  // Low-confidence safety message — shown when AI confidence remains low after clarification
  // Does NOT upgrade triage level — instead flags for nurse review and empowers the patient
  low_confidence_safety: {
    en: 'ℹ️ We have assessed your symptoms, but our confidence is lower than usual. Your triage result is still shown above.\n\nAs a precaution:\n- If your symptoms change or get worse, please come to the clinic *today*\n- A nurse has been flagged to review your case',
    zu: 'ℹ️ Sihlole izimpawu zakho, kodwa ukuqiniseka kwethu kuphansi kunokuvamile. Umphumela wakho wokuhlolwa usavezwe ngenhla.\n\nNjengesivikelo:\n- Uma izimpawu zakho zishintsha noma ziba zimbi, sicela uze emtholampilo *namuhla*\n- Umhlengikazi utshelwe ukuthi abuyekeze udaba lwakho',
    xh: 'ℹ️ Sihlole iimpawu zakho, kodwa ukuqiniseka kwethu kuphantsi kunokwesiqhelo. Isiphumo sakho sokuhlolwa sisaboniswa ngentla.\n\nNjengesikhuseleko:\n- Ukuba iimpawu zakho zitshintsha okanye ziba mbi, nceda uze ekliniki *namhlanje*\n- Umongikazi uxelelwe ukuba ahlole ityala lakho',
    af: 'ℹ️ Ons het jou simptome beoordeel, maar ons sekerheid is laer as gewoonlik. Jou resultaat word steeds hierbo gewys.\n\nAs voorsorg:\n- As jou simptome verander of vererger, kom asseblief *vandag* kliniek toe\n- \'n Verpleegster is gevra om jou geval na te gaan',
    nso: 'ℹ️ Re sekasekile dika tša gago, eupša boitshepo bja rena bo fase go feta ka tlwaelo. Poelo ya gago e sa bontšhwa ka godimo.\n\nBjalo ka tshepo:\n- Ge dika tša gago di fetoga goba di mpefala, tla kliniki *lehono*\n- Mooki o tsebišitšwe go sekaseka taba ya gago',
    tn: 'ℹ️ Re sekasekile matshwao a gago, mme boitshepo jwa rona bo kwa tlase go feta ka tlwaelo. Maduo a gago a sa bontshiwa fa godimo.\n\nJaaka tshireletso:\n- Fa matshwao a gago a fetoga kgotsa a mpefala, tla kliniki *gompieno*\n- Mooki o itsisiwe go sekaseka taba ya gago',
    st: 'ℹ️ Re sekasekile matshwao a hao, empa boitshepo ba rena bo tlase ho feta ka tlwaelo. Sephetho sa hao se sa bontshwa ka hodimo.\n\nJwalo ka tshireletso:\n- Haeba matshwao a hao a fetoha kapa a mpefala, tla kliniki *kajeno*\n- Mooki o tsebisitswe ho sekaseka taba ya hao',
    ts: 'ℹ️ Hi kambele swikombiso swa wena, kambe ku tshemba ka hina ku le hansi ku tlula ntolovelo. Mbuyelo wa wena wu ha kombisiwa laha henhla.\n\nTani hi ku tivikela:\n- Loko swikombiso swa wena swi cinca kumbe swi nyanya, ta ekliniki *namuntlha*\n- Nesi u tivisiwe ku kambela mhaka ya wena',
    ss: 'ℹ️ Sihlole timphawu takho, kodvwa kuciniseka kwetfu kuphansi kunalokujwayelekile. Umphumela wakho usaboniswa ngenhla.\n\nNjengesivikelo:\n- Nangabe timphawu takho tishintja noma tiba timbi, wota emtfolamphilo *lamuhla*\n- Umhlengikati utshelwe kutsi abuyekete indaba yakho',
    ve: 'ℹ️ Ro sedzulusa zwiga zwaṋu, fhedzi fulufhelo yashu i fhasi u fhira tsha ṱhukhu. Mvelelo yaṋu i kha ḓi sumbedzwa afho nṱha.\n\nSa tsireledzo:\n- Arali zwiga zwaṋu zwi tshi shanduka kana zwi tshi vhifha, ḓani kha kiliniki *ṋamusi*\n- Muongi o ḓivhadzwa u sedzulusa mulandu waṋu',
    nr: 'ℹ️ Sihlole iimpawu zakho, kodwana ukuqiniseka kwethu kuphansi kunokujayelekileko. Umphumela wakho usaboniswa ngaphezulu.\n\nNjengesivikelo:\n- Nangabe iimpawu zakho zitjhintjha namkha ziba zimbi, woza ekliniki *namhlanje*\n- Umhlengikazi utshelwe bona abuyekeze udaba lwakho',
  },

  // Time-aware ORANGE routing messages
  triage_orange_clinic: {
    en: (name, dist) => `🏥 Go to *${name}* (${dist} km) NOW.\n\nTell reception you were triaged as *VERY URGENT* by BIZUSIZO. You will be fast-tracked.\n\nDo not wait at home.`,
    zu: (name, dist) => `🏥 Yana ku-*${name}* (${dist} km) MANJE.\n\nTshela i-reception ukuthi uhloliwe njengo-*KUPHUTHUMA KAKHULU* yi-BIZUSIZO. Uzosheshiswa.\n\nUngalindi ekhaya.`,
    xh: (name, dist) => `🏥 Yiya ku-*${name}* (${dist} km) NGOKU.\n\nXelela i-reception ukuba uhlolwe njenge-*KUNGXAMISEKE KAKHULU* yi-BIZUSIZO. Uza kukhawuleziswa.\n\nMusa ukulinda ekhaya.`,
    af: (name, dist) => `🏥 Gaan na *${name}* (${dist} km) NOU.\n\nS\u00EA vir ontvangs jy is as *BAIE DRINGEND* deur BIZUSIZO getrieer. Jy sal vinnig gehelp word.\n\nMoenie by die huis wag nie.`,
  },

  triage_orange_hospital: {
    en: 'The clinic is closed now. Go to your nearest hospital emergency unit immediately.',
    zu: 'Umtholampilo uvaliwe manje. Yana esibhedlela esiseduze — ewodini yeziphuthumayo.',
    xh: 'Ikliniki ivaliwe ngoku. Yiya esibhedlele esikufutshane — kwicandelo lezongxamiseko.',
    af: 'Die kliniek is nou gesluit. Gaan na jou naaste hospitaal noodafdeling dadelik.',
    nso: 'Kiliniki e tswaletšwe bjale. Ya sepetleleng sa kgauswi — ka karolong ya tšhoganetšo.',
    tn: 'Kliniki e tswaletswe jaanong. Ya bookelong jo bo gaufi — ka karolong ya tshoganyetso.',
    st: 'Kliniki e koetswe joale. Eya sepetlele se haufi — karolong ya tshohanyetso.',
    ts: 'Kliniki yi pfariwile sweswi. Ya exibedlhele xa kusuhi — ka xiyenge xa swihatla.',
    ss: 'Ikliniki ivaliwe nyalo. Ya esibhedlela leseduze — endlini yekusheshisa.',
    ve: 'Kiliniki yo valwa zwino. Iyani sibadela tshi re tsini — kha tshiimiswa tsha tshoganetso.',
    nr: 'Ikliniki ivaliwe nje. Ya esibhedlela esiseduze — esigeni seziphuthumako.'
  },

  // Transport safety question for ORANGE
  ask_transport_safety: {
    en: 'Can you travel to the facility safely?\n\n1 — Yes, I can get there myself or someone can take me\n2 — No, I am too unwell to travel safely\n3 — I have no transport',
    zu: 'Ungaya endaweni yokulapha ngokuphepha?\n\n1 — Yebo, ngingaya ngokwami noma umuntu angihambisa\n2 — Cha, ngigula kakhulu ukuhamba ngokuphepha\n3 — Anginayo indlela yokuhamba',
    xh: 'Ungahamba uye kwindawo yokugula ngokukhuselekileyo?\n\n1 — Ewe, ndingaya ndodwa okanye umntu angandisa\n2 — Hayi, ndigula kakhulu ukuhamba ngokukhuselekileyo\n3 — Andinayo indlela yokuhamba',
    af: 'Kan jy veilig na die fasiliteit reis?\n\n1 — Ja, ek kan self gaan of iemand kan my neem\n2 — Nee, ek is te siek om veilig te reis\n3 — Ek het geen vervoer nie',
    nso: 'O ka ya lefelong la kalafo ka polokego?\n\n1 — Ee, nka ya ka bonna goba motho a ka ntšhiša\n2 — Aowa, ke lwala kudu go sepela ka polokego\n3 — Ga ke na sefata',
    tn: 'O ka ya lefelong la kalafi ka polokesego?\n\n1 — Ee, nka ya ka bonna kgotsa motho a ka ntisa\n2 — Nnyaa, ke lwala thata go tsamaya ka polokesego\n3 — Ga ke na sefata',
    st: 'O ka ya lefelong la bophelo ka polokeho?\n\n1 — E, nka ya ka bonna kapa motho a ka ntisa\n2 — Tjhe, ke kula haholo ho tsamaya ka polokeho\n3 — Ha ke na sefata',
    ts: 'U nga ya endhawini yo kufumela hi ku hlayiseka?\n\n1 — Ina, ndzi nga ya hi ndzi ri ndzexe kumbe munhu a nga ndzi yisa\n2 — Ee-ee, ndzi vabya ngopfu ku famba hi ku hlayiseka\n3 — A ndzi na xifambisi',
    ss: 'Ungaya endzaweni yelatjhwa ngekuphepha?\n\n1 — Yebo, ngingaya ngedvwa noma umuntfu angihambisa\n2 — Cha, ngigula kakhulu kuhamba ngekuphepha\n3 — Anginayo indlela yekuhamba',
    ve: 'Ni nga ya fhethu ha u alafhiwa nga u tsireledza?\n\n1 — Ee, ndi nga ya nga ndoṱhe kana muthu a nga ntshimbila\n2 — Hai, ndi khou lwala vhukuma u tshimbila nga u tsireledza\n3 — A thi na tshifhambisi',
    nr: 'Ungaya endaweni yokulatjhwa ngokuphepha?\n\n1 — Iye, ngingaya ngedwa namkha umuntu angangihambisa\n2 — Awa, ngigula khulu ukukhamba ngokuphepha\n3 — Anginayo indlela yokukhamba',
  },

  transport_safe: {
    en: 'Good. Please leave now — do not delay.',
    zu: 'Kuhle. Sicela uhambe manje — ungalibali.',
    xh: 'Kulungile. Nceda uhambe ngoku — musa ukulibazisa.',
    af: 'Goed. Vertrek asseblief nou — moenie uitstel nie.',
    nso: 'Ke botse. Tšwela pele bjale — o se ke wa diega.',
    tn: 'Go siame. Tswelela pele jaanong — o se ke wa diega.',
  },

  transport_unsafe: {
    en: '🚑 Call an ambulance NOW:\n*10177* (public) or *084 124* (ER24)\n\nTell them your symptoms and location.\n\nIf the ambulance is slow, ask someone nearby to drive you to the nearest hospital emergency unit. Do not wait at home.',
    zu: '🚑 Shaya i-ambulensi MANJE:\n*10177* (kahulumeni) noma *084 124* (ER24)\n\nBatshele izimpawu zakho nendawo yakho.\n\nUma i-ambulensi iphuza, cela umuntu oseduze akushayele esibhedlela. Ungalindi ekhaya.',
    xh: '🚑 Tsalela i-ambulensi NGOKU:\n*10177* (karhulumente) okanye *084 124* (ER24)\n\nBaxelele iimpawu zakho nendawo yakho.\n\nUkuba i-ambulensi ilibele, cela umntu okufutshane akuqhubele esibhedlele. Musa ukulinda ekhaya.',
    af: '🚑 Bel \'n ambulans NOU:\n*10177* (publiek) of *084 124* (ER24)\n\nVertel hulle jou simptome en ligging.\n\nAs die ambulans stadig is, vra iemand naby om jou na die naaste hospitaal noodafdeling te ry. Moenie by die huis wag nie.',
    nso: '🚑 Letša ambulense BJALE:\n*10177* (mmušo) goba *084 124* (ER24)\n\nBalatela ka matšoenyego a gago le lefelo la gago.\n\nGe ambulense e diega, kgopela motho yo a gauswi gore a go ise sepetlele. O se ke wa ema gae.',
    tn: '🚑 Letsa ambulense JAANONG:\n*10177* (mmuso) kgotsa *084 124* (ER24)\n\nBabuisa ka matshwenyego a gago le lefelo la gago.\n\nFa ambulense e diega, kopa motho yo o gaufi go go isa bookelong. O se ka wa ema gae.',
  },

  transport_none: {
    en: '🚑 Call an ambulance: *10177* or *084 124* (ER24)\n\nAlternatively, ask a neighbour, family member, or community member to take you. If you can reach a taxi rank, take a taxi to the nearest clinic or hospital.\n\nDo not stay at home — you need care today.',
    zu: '🚑 Shaya i-ambulensi: *10177* noma *084 124* (ER24)\n\nNoma ucele umakhelwane, ilungu lomndeni, noma ilungu lomphakathi likuhambise. Uma ungafinyelela erenki yamatekisi, thatha itekisi uye emtholampilo noma esibhedlela.\n\nUngahlali ekhaya — udinga usizo namuhla.',
    xh: '🚑 Tsalela i-ambulensi: *10177* okanye *084 124* (ER24)\n\nOkanye cela ummelwane, ilungu losapho, okanye ilungu lasekuhlaleni likuse. Ukuba ungafikelela kwindawo yamateksi, thatha iteksi uye ekliniki okanye esibhedlele.\n\nMusa ukuhlala ekhaya — ufuna inkathalo namhlanje.',
    af: '🚑 Bel \'n ambulans: *10177* of *084 124* (ER24)\n\nOf vra \'n buurman, familielid, of gemeenskapslid om jou te neem. As jy \'n taxistaanplek kan bereik, neem \'n taxi na die naaste kliniek of hospitaal.\n\nMoenie by die huis bly nie — jy het vandag sorg nodig.',
  },

  triage_yellow: {
    en: '🟡 *URGENT*\nVisit a clinic today. Do not delay.',
    zu: '🟡 *KUPHUTHUMA*\nVakashela umtholampilo namuhla. Ungalibali.',
    xh: '🟡 *KUNGXAMISEKILE*\nTyelela ikliniki namhlanje. Musa ukulibazisa.',
    af: '🟡 *DRINGEND*\nBesoek \'n kliniek vandag. Moenie uitstel nie.',
    nso: '🟡 *GO A ŠUTIŠWA*\nEtela kiliniki lehono. O se lebe.',
    tn: '🟡 *GO A TSHOGANYETSA*\nEtela kliniki gompieno. O se ka wa diega.',
    st: '🟡 *HO A POTLAKISA*\nEtela kliniki kajeno. O se ke oa dieha.',
    ts: '🟡 *SWA HATLISA*\nEndzela kliniki namuntlha. U nga hlweli.',
    ss: '🟡 *KUYASHESHISA*\nVakashela ikliniki lamuhla. Ungalibali.',
    ve: '🟡 *ZWO ṰOḒEA*\nDalani kiliniki ṋamusi. Ni songo lenga.',
    nr: '🟡 *KUPHUTHUMA*\nVakatjhela ikliniki namhlanje. Ungalisi.'
  },

  triage_yellow_after_hours: {
    en: '⏰ Clinics are closed now. Here is what to do:\n\n1. *If your symptoms are manageable* — rest at home and go to the clinic first thing tomorrow morning (before 08:00 for the shortest wait)\n\n2. *If symptoms worsen tonight* — go to your nearest hospital emergency unit or call *10177*\n\nWe will send you a reminder tomorrow morning.',
    zu: '⏰ Imitholampilo ivaliwe manje. Nanti okumele ukwenze:\n\n1. *Uma izimpawu zakho zibekezeleka* — phumula ekhaya bese uya emtholampilo ekuseni kakhulu kusasa (ngaphambi kuka-08:00)\n\n2. *Uma izimpawu ziba zimbi ebusuku* — yana esibhedlela esiseduze noma ushaye *10177*\n\nSizokuthumelela isikhumbuzo kusasa ekuseni.',
    xh: '⏰ Iikliniki zivaliwe ngoku. Nantsi into omawuyenze:\n\n1. *Ukuba iimpawu zakho zinokumelana nazo* — phumla ekhaya uze uye ekliniki kwangethuba ngomso ekuseni (phambi kwe-08:00)\n\n2. *Ukuba iimpawu ziba mbi ebusuku* — yiya esibhedlele esikufutshane okanye utsalele *10177*\n\nSiza kukuthumela isikhumbuzo ngomso ekuseni.',
    af: '⏰ Klinieke is nou gesluit. Hier is wat om te doen:\n\n1. *As jou simptome hanteerbaar is* — rus by die huis en gaan m\u00F4re vroeg na die kliniek (voor 08:00 vir die kortste wag)\n\n2. *As simptome vanaand vererger* — gaan na jou naaste hospitaal noodafdeling of bel *10177*\n\nOns sal jou m\u00F4reoggend \'n herinnering stuur.',
    nso: '⏰ Dikiliniki di tswaletšwe bjale. Se o swanetšego go se dira ke se:\n\n1. *Ge dika tša gago di kgotlelega* — ikhutša ka gae o ye kiliniki gosasa ka pela (pele ga 08:00)\n\n2. *Ge dika di mpefala bošego* — ya sepetleleng sa kgauswi goba o leletše *10177*\n\nRe tla go romela sekhumbuzo gosasa ka mesa.',
    tn: '⏰ Dikliniki di tswaletswe jaanong. Se o tshwanetseng go se dira ke se:\n\n1. *Fa matshwao a gago a kgotlelega* — ikhutsa kwa gae o ye kliniki mo mosong ka bonako (pele ga 08:00)\n\n2. *Fa matshwao a maswe bosigo* — ya bookelong jo bo gaufi kgotsa o leletse *10177*\n\nRe tla go romela sekgopotso kamoso mo mosong.',
    st: '⏰ Dikliniki di koetswe joale. Seo o lokelang ho se etsa ke sena:\n\n1. *Haeba matshwao a hao a ka kgotlelwa* — ikhutse hae o ye kliniki hosane ka pela (pele ho 08:00)\n\n2. *Haeba matshwao a mpefala bosiu* — eya sepetlele se haufi kapa o letsetse *10177*\n\nRe tla o romella sekhumbutso hosane ka mesa.',
    ts: '⏰ Tikliniki ti pfariwile sweswi. Hi leswi u faneleke ku swi endla:\n\n1. *Loko swikombiso swa wena swi koteka* — wisa ekaya u ya ekliniki mundzuku nimixo (pele ka 08:00)\n\n2. *Loko swikombiso swi tika nivusiku* — ya exibedlhele xa kusuhi kumbe u ringela *10177*\n\nHi ta ku rhumela xikhumbutso mundzuku nimixo.',
    ss: '⏰ Tikliniki tivaliwe nyalo. Naku lokufanele ukwente:\n\n1. *Nangabe timphawu takho tiyabeketeleka* — phumula ekhaya uye ekliniki ekuseni kusasa (ngaphambi kwa-08:00)\n\n2. *Nangabe timphawu tiba timbi ebusuku* — ya esibhedlela leseduze noma ushayele *10177*\n\nSitakutfumelela sikhumbuzo kusasa ekuseni.',
    ve: '⏰ Dikiliniki dzo valwa zwino. Ndi izwi zwine na tea u ita:\n\n1. *Arali zwiga zwaṋu zwi kona u konḓelelwa* — awelani hayani ni ye kiliniki matshelo nga u ṱavhanya (phanḓa ha 08:00)\n\n2. *Arali zwiga zwi tshi ṱavhanya vhusiku* — iyani sibadela tshi re tsini kana ni founele *10177*\n\nRi ḓo ni rumela tsivhudzo matshelo nga matsheloni.',
    nr: '⏰ Iinkliniki zivaliwe nje. Naku okufanele ukwenze:\n\n1. *Uma iimpawu zakho zibekezeleka* — phumula ekhaya uye ekliniki kusasa ekuseni (ngaphambi kwe-08:00)\n\n2. *Uma iimpawu ziba zimbi ebusuku* — ya esibhedlela esiseduze namkha uringele *10177*\n\nSizakukuthumela isikhumbuzo kusasa ekuseni.'
  },

  // WhatsApp notification when patient is called from dashboard
  queue_called: {
    en: (assignedTo) => `📢 *You are being called!*\n\n${assignedTo ? 'Please go to *' + assignedTo + '* now.' : 'Please go to reception now.'}\n\nHave your ID and clinic card ready.`,
    zu: (assignedTo) => `📢 *Uyabizwa!*\n\n${assignedTo ? 'Sicela uye ku-*' + assignedTo + '* manje.' : 'Sicela uye e-reception manje.'}\n\nLungisa i-ID nekhadi lakho lasemtholampilo.`,
    xh: (assignedTo) => `📢 *Uyabizwa!*\n\n${assignedTo ? 'Nceda uye ku-*' + assignedTo + '* ngoku.' : 'Nceda uye e-reception ngoku.'}\n\nLungisa i-ID nekhadi lakho lasekliniki.`,
    af: (assignedTo) => `📢 *Jy word geroep!*\n\n${assignedTo ? 'Gaan asseblief na *' + assignedTo + '* nou.' : 'Gaan asseblief na ontvangs nou.'}\n\nHou jou ID en kliniekkaart gereed.`,
  },

  triage_green: {
    en: '🟢 *ROUTINE — Non-urgent*\n\nYour symptoms are not an emergency. Here is some advice while you decide your next step:',
    zu: '🟢 *OKUJWAYELEKILE — Akuphuthumi*\n\nIzimpawu zakho azizona isimo esiphuthumayo. Nalu usizo ngesikhathi unquma okuzayo:',
    xh: '🟢 *OKUQHELEKILEYO — Akungxamisekanga*\n\nIimpawu zakho aziyongxaki engxamisekileyo. Nantsi ingcebiso ngelixa usenza isigqibo:',
    af: '🟢 *ROETINE — Nie-dringend*\n\nJou simptome is nie \'n noodgeval nie. Hier is raad terwyl jy besluit:',
    nso: '🟢 *TSA TLWAELO — Ga se tšhoganetšo*\n\nDika tša gago ga se tšhoganetšo. Maele a ge o nagana ka mohato wo o latelago:',
    tn: '🟢 *TSA TLWAELO — Ga se tshoganyetso*\n\nMatshwao a gago ga se tshoganyetso. Dikeletso fa o akanya ka kgato e e latelang:',
    st: '🟢 *TSA KAMEHLA — Ha se tshohanyetso*\n\nMatshwao a hao ha se tshohanyetso. Dikeletso ha o nahana ka mohato o latelang:',
    ts: '🟢 *SWA NTOLOVELO — A hi xihatla*\n\nSwikombiso swa wena a hi xihatla. Maele loko u ehleketa hi goza leri landzelaka:',
    ss: '🟢 *KWEKUVAMILE — Akuphutfumi*\n\nTimphawu takho akusiko simo lesiphutfumako. Emacebo nawucabanga ngesinyatselo lesilandzelako:',
    ve: '🟢 *ZWA ḒUVHA ḼI ṄWE NA ḼI ṄWE — A si tshoganetso*\n\nZwiga zwaṋu a si tshoganetso. Nyeletshedzo musi ni tshi khou humbula nga kuitele kwi ḓaho:',
    nr: '🟢 *OKUJAYELEKILEKO — Akuphuthumisi*\n\nIimpawu zakho akusiso isimo esiphuthumako. Amacebo nawucabanga ngesinyathelo esilandelako:'
  },

  // ==================== FACILITY ROUTING ====================
  facility_suggest: {
    en: (name, dist) => `📍 Nearest facility: *${name}* (${dist} km away).\n\nCan you get there easily?\n1 — Yes, take me there\n2 — No, show me other options`,
    zu: (name, dist) => `📍 Indawo eseduze: *${name}* (${dist} km).\n\nUngafika kalula?  \n1 — Yebo\n2 — Cha, ngikhombise ezinye`,
    xh: (name, dist) => `📍 Indawo ekufutshane: *${name}* (${dist} km).\n\nUngafikelela lula?\n1 — Ewe\n2 — Hayi, ndibonise ezinye`,
    af: (name, dist) => `📍 Naaste fasiliteit: *${name}* (${dist} km).\n\nKan jy maklik daar uitkom?\n1 — Ja\n2 — Nee, wys my ander opsies`,
    nso: (name, dist) => `📍 Lefelo la kgauswi: *${name}* (${dist} km).\n\nO ka fihla gabonolo?\n1 — Ee\n2 — Aowa, mpontšhe tše dingwe`,
    tn: (name, dist) => `📍 Lefelo le le gaufi: *${name}* (${dist} km).\n\nO ka fitlha motlhofo?\n1 — Ee\n2 — Nnyaa, mpontshee tse dingwe`,
    st: (name, dist) => `📍 Lefelo le haufi: *${name}* (${dist} km).\n\nO ka fihla habonolo?\n1 — E\n2 — Tjhe, mpontshe tse ding`,
    ts: (name, dist) => `📍 Ndhawu ya kusuhi: *${name}* (${dist} km).\n\nU nga fikela ku olova?\n1 — Ina\n2 — Ee-ee, ndzi kombela tin'wana`,
    ss: (name, dist) => `📍 Indzawo yaseduze: *${name}* (${dist} km).\n\nUngafika kalula?\n1 — Yebo\n2 — Cha, ngikhombise letinye`,
    ve: (name, dist) => `📍 Fhethu hu re tsini: *${name}* (${dist} km).\n\nNi nga swika hu leluwa?\n1 — Ee\n2 — Hai, nsumbedzeni zwiṅwe`,
    nr: (name, dist) => `📍 Indawo eseduze: *${name}* (${dist} km).\n\nUngafika bulula?\n1 — Iye\n2 — Awa, ngikhombise ezinye`
  },

  facility_confirmed: {
    en: (name) => `✅ Go to *${name}*.\n\n📋 *When you arrive:*\n1. Go to reception\n2. Tell them: "I used BIZUSIZO"\n3. Show your reference number (type *code* to see it)\n4. They already have your details\n\nSafe travels. We will check in with you in 48 hours.`,
    zu: (name) => `✅ Yana ku-*${name}*.\n\n📋 *Uma ufika:*\n1. Yana e-reception\n2. Batshele: "Ngisebenzise i-BIZUSIZO"\n3. Bakhombise inombolo yakho (bhala *code*)\n4. Sebe nemininingwane yakho\n\nUhambe kahle. Sizokubuza emva kwamahora angu-48.`,
    xh: (name) => `✅ Yiya ku-*${name}*.\n\n📋 *Xa ufika:*\n1. Yiya e-reception\n2. Baxelele: "Ndisebenzise i-BIZUSIZO"\n3. Babonise inombolo yakho (bhala *code*)\n4. Banayo inkcazelo yakho\n\nUhambe kakuhle. Siza kukubuza emva kweeyure ezingama-48.`,
    af: (name) => `✅ Gaan na *${name}*.\n\n📋 *Wanneer jy aankom:*\n1. Gaan na ontvangs\n2. Sê vir hulle: "Ek het BIZUSIZO gebruik"\n3. Wys jou verwysingsnommer (tik *code*)\n4. Hulle het reeds jou besonderhede\n\nVeilige reis. Ons sal oor 48 uur by jou inskakel.`,
    nso: (name) => `✅ Yaa go *${name}*.\n\n📋 *Ge o fihla:*\n1. Yaa go reception\n2. Ba botše: "Ke šomišitše BIZUSIZO"\n3. Ba bontšhe nomoro ya gago (ngwala *code*)\n4. Ba na le tshedimošo ya gago\n\nO sepele gabotse. Re tla go botšiša morago ga diiri tše 48.`,
    tn: (name) => `✅ Ya go *${name}*.\n\n📋 *Fa o goroga:*\n1. Ya kwa go reception\n2. Ba bolelele: "Ke dirisitse BIZUSIZO"\n3. Ba bontshe nomoro ya gago (kwala *code*)\n4. Ba na le tshedimosetso ya gago\n\nO tsamae sentle. Re tla go botsa morago ga diura di le 48.`,
    st: (name) => `✅ Eya ho *${name}*.\n\n📋 *Ha o fihla:*\n1. Eya ho reception\n2. Ba bolelle: "Ke sebedisitse BIZUSIZO"\n3. Ba bontshe nomoro ya hao (ngola *code*)\n4. Ba na le tlhahisoleseding ya hao\n\nO tsamae hantle. Re tla o botsa kamora hora tse 48.`,
    ts: (name) => `✅ Famba u ya eka *${name}*.\n\n📋 *Loko u fika:*\n1. Yaa eka reception\n2. Va byela: "Ndzi tirhisile BIZUSIZO"\n3. Va kombela nomboro ya wena (tsala *code*)\n4. Va na vuxokoxoko bya wena\n\nU famba kahle. Hi ta ku vutisa endzhaku ka tiawara ta 48.`,
    ss: (name) => `✅ Hamba uye ku-*${name}*.\n\n📋 *Nawufika:*\n1. Ya ku-reception\n2. Batjele: "Ngisebentise i-BIZUSIZO"\n3. Bakhombise inombolo yakho (bhala *code*)\n4. Sebe nemininingwane yakho\n\nUhambe kahle. Sitakubutsa emvakwema-awa langu-48.`,
    ve: (name) => `✅ Iyani kha *${name}*.\n\n📋 *Musi ni tshi swika:*\n1. Iyani kha reception\n2. Vha vhudzeni: "Ndo shumisa BIZUSIZO"\n3. Vha sumbedzeni nomboro yaṋu (ṅwalani *code*)\n4. Vha na mafhungo aṋu\n\nNi tshimbile zwavhuḓi. Ri ḓo ni vhudzisa nga murahu ha awara dza 48.`,
    nr: (name) => `✅ Iya ku-*${name}*.\n\n📋 *Nawufikako:*\n1. Iya ku-reception\n2. Babatjele: "Ngisebenzise i-BIZUSIZO"\n3. Bakhombise inomboro yakho (tlola *code*)\n4. Banawo imininingwane yakho\n\nUkhambe kuhle. Sizakubuza ngemva kwama-iri angu-48.`
  },

  facility_alternatives: {
    en: (facilities, firstName) => `Here are other options nearby:\n${facilities}\n\n0 — Go back to the first suggestion${firstName ? ' (*' + firstName + '*)' : ''}\n\nReply with the number of your choice.`,
    zu: (facilities, firstName) => `Nazi ezinye izindawo eziseduze:\n${facilities}\n\n0 — Buyela esiphakamisweni sokuqala${firstName ? ' (*' + firstName + '*)' : ''}\n\nPhendula ngenombolo oyikhethayo.`,
    xh: (facilities, firstName) => `Nazi ezinye iindawo ezikufutshane:\n${facilities}\n\n0 — Buyela kwisiphakamiso sokuqala${firstName ? ' (*' + firstName + '*)' : ''}\n\nPhendula ngenombolo oyikhethayo.`,
    af: (facilities, firstName) => `Hier is ander opsies naby:\n${facilities}\n\n0 — Gaan terug na die eerste voorstel${firstName ? ' (*' + firstName + '*)' : ''}\n\nAntwoord met die nommer van jou keuse.`,
    nso: (facilities, firstName) => `Tše ke mafelo a mangwe a kgauswi:\n${facilities}\n\n0 — Boela go keletšo ya mathomo${firstName ? ' (*' + firstName + '*)' : ''}\n\nAraba ka nomoro ya kgetho ya gago.`,
    tn: (facilities, firstName) => `Ke mafelo a mangwe a gaufi:\n${facilities}\n\n0 — Boela kwa kgakololong ya ntlha${firstName ? ' (*' + firstName + '*)' : ''}\n\nAraba ka nomoro ya kgetho ya gago.`,
    st: (facilities, firstName) => `Mona ke mafelo a mang a haufi:\n${facilities}\n\n0 — Khutlela kgakololong ya pele${firstName ? ' (*' + firstName + '*)' : ''}\n\nAraba ka nomoro ya kgetho ya hao.`,
    ts: (facilities, firstName) => `Leti i tindhawu tin'wana ta kusuhi:\n${facilities}\n\n0 — Tlhelela eka xiringanyeto xo sungula${firstName ? ' (*' + firstName + '*)' : ''}\n\nHlamula hi nomboro ya nhlawulo wa wena.`,
    ss: (facilities, firstName) => `Nati letinye tindzawo letisetfuze:\n${facilities}\n\n0 — Buyela esiphakamisweni sekucala${firstName ? ' (*' + firstName + '*)' : ''}\n\nPhendvula ngenombolo yalokukhetsa kwakho.`,
    ve: (facilities, firstName) => `Hafha ndi huṅwe fhethu hu re tsini:\n${facilities}\n\n0 — Humbelani u vhuyelela kha tshiṅwelo tsha u thoma${firstName ? ' (*' + firstName + '*)' : ''}\n\nFhindulani nga nomboro ya khetho yaṋu.`,
    nr: (facilities, firstName) => `Nazi ezinye iindawo ezisetjhezi:\n${facilities}\n\n0 — Buyela esiphakamisweni sokuthoma${firstName ? ' (*' + firstName + '*)' : ''}\n\nPhendula ngenomboro yalokukhetha kwakho.`
  },

  // ==================== FOLLOW-UP ====================
  follow_up: {
    en: `Hi, you contacted BIZUSIZO 2 days ago. How are your symptoms?
1. Better ✅
2. The same ➡️
3. Worse ⚠️`,
    zu: `Sawubona, usithintile eBIZUSIZO ezinsukwini ezi-2 ezedlule. Zinjani izimpawu zakho?
1. Zingcono ✅
2. Ziyafana ➡️
3. Zimbi kakhulu ⚠️`,
    xh: `Molo, uqhagamshelane neBIZUSIZO kwiintsuku ezi-2 ezidlulileyo. Zinjani iimpawu zakho?
1. Zibhetele ✅
2. Ziyafana ➡️
3. Zimbi ngakumbi ⚠️`,
    af: `Hallo, jy het 2 dae gelede BIZUSIZO gekontak. Hoe is jou simptome?
1. Beter ✅
2. Dieselfde ➡️
3. Erger ⚠️`,
    nso: `Thobela, o ikgokagantše le BIZUSIZO matšatši a 2 a go feta. Dika tša gago di bjang?
1. Di kaone ✅
2. Di swana ➡️
3. Di mpefetše ⚠️`,
    tn: `Dumela, o ikgolagantse le BIZUSIZO malatsi a 2 a a fetileng. Matshwao a gago a ntse jang?
1. A botoka ✅
2. A tshwana ➡️
3. A maswe go feta ⚠️`,
    st: `Lumela, o ikopantse le BIZUSIZO matsatsi a 2 a fetileng. Matshwao a hao a jwang?
1. A betere ✅
2. A tshwana ➡️
3. A mpe ho feta ⚠️`,
    ts: `Xewani, u ti tshikelele na BIZUSIZO masiku ya 2 ya hundzi. Swikombiso swa wena swi njhani?
1. Swi antswa ✅
2. Swi fanana ➡️
3. Swi tika ku tlula ⚠️`,
    ss: `Sawubona, usitsintsile eBIZUSIZO emalangeni la-2 langetulu. Tinjani timphawu takho?
1. Tincono ✅
2. Tiyafana ➡️
3. Timbi kakhulu ⚠️`,
    ve: `Aa, no kwama BIZUSIZO maḓuvha a 2 o fhelaho. Zwiga zwaṋu zwi hani?
1. Zwo khwiṋa ✅
2. Zwi a fana ➡️
3. Zwo ṱoḓa u ṱavhanya ⚠️`,
    nr: `Lotjha, usitjheje ku-BIZUSIZO emalangeni la-2 langaphambili. Iimpawu zakho zinjani?
1. Zincono ✅
2. Ziyafana ➡️
3. Zimbi khulu ⚠️`
  },

  follow_up_better: {
    en: '✅ Glad you are feeling better. No further action needed. Stay well!',
    zu: '✅ Siyajabula ukuthi uzizwa ngcono. Akukho okunye okudingekayo. Hlala kahle!',
    xh: '✅ Siyavuya ukuba uziva ngcono. Akukho nto yimbi efunekayo. Hlala kakuhle!',
    af: '✅ Bly jy voel beter. Geen verdere aksie nodig nie. Bly gesond!',
    nso: '✅ Re thabile ge o ikwa kaone. Ga go nyakega selo gape. Phela gabotse!',
    tn: '✅ Re itumetse fa o ikutlwa botoka. Ga go tlhokege sepe gape. Nna sentle!',
    st: '✅ Re thabile ha o ikutlwa betere. Ha ho hlokahale letho hape. Phela hantle!',
    ts: '✅ Hi tsakile leswaku u titwa u antswa. A ku na swo engetela swi lavekaka. Tshama kahle!',
    ss: '✅ Siyajabula kutsi utiva uncono. Akukho lokunye lokufunekako. Hlala kahle!',
    ve: '✅ Ri takala ngauri ni ḓipfa khwine. A hu na zwiṅwe zwi ṱoḓeaho. Dzulani zwavhuḓi!',
    nr: '✅ Siyathaba kuthi uzizwa ncono. Akukho okhunye okutlhogekako. Hlala kuhle!'
  },

  follow_up_same: {
    en: '🟡 Please continue monitoring your symptoms. Visit a clinic if they do not improve in the next 24 hours.',
    zu: '🟡 Qhubeka uqaphelisisa izimpawu zakho. Vakashela umtholampilo uma zingabi ngcono emahoreni angu-24.',
    xh: '🟡 Qhubeka ujonga iimpawu zakho. Tyelela ikliniki ukuba azibhetele kwiiyure ezingama-24.',
    af: '🟡 Hou asseblief aan om simptome te monitor. Besoek \'n kliniek as dit nie binne 24 uur verbeter nie.',
    nso: '🟡 Tšwela pele o šetša dika tša gago. Etela kiliniki ge di sa kaone ka diiri tše 24.',
    tn: '🟡 Tswelela o ela tlhoko matshwao a gago. Etela kliniki fa a sa tokafale ka diura di le 24.',
    st: '🟡 Tswela pele o sheba matshwao a hao. Etela kliniki haeba a sa tokafale ka hora tse 24.',
    ts: '🟡 Yisa emahlweni u vona swikombiso swa wena. Endzela kliniki loko swi nga antswa hi tiawara ta 24.',
    ss: '🟡 Chubeka ucaphelisise timphawu takho. Vakashela ikliniki uma tingabi ncono ngema-awa langu-24.',
    ve: '🟡 Bveledzani u sedza zwiga zwaṋu. Dalani kiliniki arali zwi sa khwiṋi nga awara dza 24.',
    nr: '🟡 Ragela phambili uqale iimpawu zakho. Vakatjhela ikliniki uma zingabi ncono ngema-iri angu-24.'
  },

  follow_up_worse: {
    en: '⚠️ Your symptoms may be worsening. A nurse has been notified and will review your case. If it is an emergency, call *10177* now.',
    zu: '⚠️ Izimpawu zakho zingase zibe zimbi. Unesi wazisiwe futhi uzobheka udaba lwakho. Uma kuphuthumile, shaya *10177* manje.',
    xh: '⚠️ Iimpawu zakho zisenokuba zimbi. Umongikazi wazisiwe kwaye uza kuhlola udaba lwakho. Ukuba yingxakeko, tsalela *10177* ngoku.',
    af: '⚠️ Jou simptome mag vererger. \'n Verpleegster is in kennis gestel. As dit \'n noodgeval is, bel *10177* nou.',
    nso: '⚠️ Dika tša gago di ka mpefala. Mooki o tsebišitšwe. Ge e le tšhoganetšo, leletša *10177* bjale.',
    tn: '⚠️ Matshwao a gago a ka nna a maswe. Mooki o itsisiwe. Fa e le tshoganyetso, leletsa *10177* jaanong.',
    st: '⚠️ Matshwao a hao a ka mpefala. Mooki o tsebisitswe. Haeba ke tshohanyetso, letsetsa *10177* hona joale.',
    ts: '⚠️ Swikombiso swa wena swi nga tika. Nesi u tivisiwe. Loko ku ri xihatla, ringela *10177* sweswi.',
    ss: '⚠️ Timphawu takho tingaba timbi. Nesi watiwe. Uma kuyinto lesheshisako, shayela *10177* nyalo.',
    ve: '⚠️ Zwiga zwaṋu zwi nga vha zwi khou ṱavhanya. Nese o ḓivhadzwa. Arali i tshoganetso, founelani *10177* zwino.',
    nr: '⚠️ Iimpawu zakho zingaba zimbi. Unesi utjhejisiwe. Uma kuphuthumako, ringela *10177* nje.'
  },

  // ==================== FOLLOW-UP OUTCOME — CLINIC VISIT QUESTION ====================
  follow_up_clinic_visit: {
    en: `One more question — did you visit the clinic after your triage?

1 — Yes, I went to the clinic ✅
2 — No, I did not go ❌
3 — I went to a hospital instead 🏥
4 — I went but was turned away ⛔
5 — I went but there was no medicine 💊`,
    zu: `Umbuzo owodwa — ngabe uvakashele umtholampilo ngemuva kokuhloliwe?

1 — Yebo, ngiya emtholampilo ✅
2 — Cha, angihambanga ❌
3 — Ngaya esibhedlela esikhundleni 🏥
4 — Ngaya kodwa ngabuyiselwa emuva ⛔
5 — Ngaya kodwa bekungekho muthi 💊`,
    xh: `Umbuzo omnye — ngaba utyelele ikliniki emva kokuhloliwa?

1 — Ewe, ndiye ekliniki ✅
2 — Hayi, andihambanga ❌
3 — Ndiye esibhedlele kunye 🏥
4 — Ndiye kodwa ndabuyiselwa ⛔
5 — Ndiye kodwa kwakungekho amayeza 💊`,
    af: `Nog een vraag — het jy die kliniek besoek na jou triage?

1 — Ja, ek het die kliniek toe gegaan ✅
2 — Nee, ek het nie gegaan nie ❌
3 — Ek het eerder na 'n hospitaal gegaan 🏥
4 — Ek het gegaan maar is weggestuur ⛔
5 — Ek het gegaan maar daar was geen medisyne nie 💊`,
    nso: `Potšišo ye nngwe — na o ile kiliniki ka morago ga go hlolwa?

1 — Ee, ke ile kiliniki ✅
2 — Aowa, ga ke ya ❌
3 — Ke ile sepetlele esikhundleni 🏥
4 — Ke ile eupša ka boa ke sa hlokomelwa ⛔
5 — Ke ile eupša ga go ya dihlare 💊`,
    tn: `Potso e nngwe — a o ile kliniki morago ga go hlahlobiwa?

1 — Ee, ke ile kliniki ✅
2 — Nnyaa, ga ke ya ❌
3 — Ke ile bookelong esikhundleni 🏥
4 — Ke ile mme ka boelediwa ⛔
5 — Ke ile mme ga go na didirisiwa tsa kalafi 💊`,
    st: `Potso e nngwe — na o ile kliniki kamora ho hlahlobiwa?

1 — E, ke ile kliniki ✅
2 — Tjhe, ha ke ya ❌
3 — Ke ile sepetlele esikhundleni 🏥
4 — Ke ile empa ka oa khutswa ⛔
5 — Ke ile empa ha ho na lithethefatsi 💊`,
    ts: `Xivutiso xin'wana — xana u endlele kliniki endzhaku ka ku hlahlobiwa?

1 — Ina, ndzi ile kliniki ✅
2 — E-e, a ndzi yanga ❌
3 — Ndzi ile xibedlhele esikhundleni 🏥
4 — Ndzi ile kambe ndzi vuliwa ⛔
5 — Ndzi ile kambe ku hava manganyana 💊`,
    ss: `Umbuzo munye — ngabe uvakashele ikliniki ngemuva kwekuhloliwa?

1 — Yebo, ngiye ekliniki ✅
2 — Cha, angiyanga ❌
3 — Ngiye esibhedlela esikhundleni 🏥
4 — Ngiye kodwa ngabuyiselwa ⛔
5 — Ngiye kodwa bekungekho umutsi 💊`,
    ve: `Mbudziso u muthihi — na no dalela kiliniki musi no fhiwa triage?

1 — Ee, ndo ya kiliniki ✅
2 — Hai, a ndo ngo ya ❌
3 — Ndo ya sibadela esikhundleni 🏥
4 — Ndo ya fhedzi ndo fudzwa ⛔
5 — Ndo ya fhedzi hu si na milayo 💊`,
    nr: `Umbuzo owodwa — ngabe uvakashele ikliniki ngemuva kokuhloliwa?

1 — Iye, ngiye ekliniki ✅
2 — Awa, angiyanga ❌
3 — Ngiye esibhedlela esikhundleni 🏥
4 — Ngiye kodwa ngabuyiselwa ⛔
5 — Ngiye kodwa bekungekho umuthi 💊`
  },

  follow_up_clinic_thanks: {
    en: `Thank you. Your response helps us improve BIZUSIZO for everyone. Stay well. 🙏`,
    zu: `Ngiyabonga. Impendulo yakho isixhasa ukuthuthukisa i-BIZUSIZO. Hlala kahle. 🙏`,
    xh: `Enkosi. Impendulo yakho isinceda ukuphucula i-BIZUSIZO. Hlala kakuhle. 🙏`,
    af: `Dankie. Jou antwoord help ons om BIZUSIZO te verbeter. Bly gesond. 🙏`,
    nso: `Ke a leboga. Karabo ya gago e re thušha go kaonafatša BIZUSIZO. Phela gabotse. 🙏`,
    tn: `Ke a leboga. Karabo ya gago e re thusa go tokafatsa BIZUSIZO. Nna sentle. 🙏`,
    st: `Ke a leboha. Karabo ya hao e re thusa ho kaonafatsa BIZUSIZO. Phela hantle. 🙏`,
    ts: `Inkomu. Nhlamulo ya wena yi hi pfuna ku antswisa BIZUSIZO. Tshama kahle. 🙏`,
    ss: `Ngiyabonga. Impendulo yakho isisita kutfutfukisa BIZUSIZO. Hlala kahle. 🙏`,
    ve: `Ndo livhuwa. Fhindulo yaṋu yo ri thusa u khwinhisa BIZUSIZO. Dzulani zwavhuḓi. 🙏`,
    nr: `Ngiyabonga. Impendulo yakho isisiza ukuthuthukisa BIZUSIZO. Hlala kuhle. 🙏`
  },

  // ==================== LOCATION REQUEST ====================
  request_location: {
    en: '📍 Please share your location so we can find the nearest facility.\n\nTap the 📎 (attachment) button → Location → Send your current location.',
    zu: '📍 Sicela uthumele indawo yakho ukuze sithole indawo yokulapha eseduze.\n\nCindezela inkinobho ye-📎 → Indawo → Thumela indawo yakho yamanje.',
    xh: '📍 Nceda wabelane ngendawo yakho ukuze sifumane indawo yokugula ekufutshane.\n\nCofa iqhosha le-📎 → Indawo → Thumela indawo yakho yangoku.',
    af: '📍 Deel asseblief jou ligging sodat ons die naaste fasiliteit kan vind.\n\nTik die 📎 knoppie → Ligging → Stuur jou huidige ligging.',
    nso: '📍 Hle abelana lefelo la gago gore re hwetše lefelo la kalafo la kgauswi.\n\nTobetša konopo ya 📎 → Lefelo → Romela lefelo la gago la bjale.',
    tn: '📍 Tswee-tswee abelana lefelo la gago gore re bone lefelo la kalafi le le gaufi.\n\nTobetsa konopo ya 📎 → Lefelo → Romela lefelo la gago la jaanong.',
    st: '📍 Ka kopo arolelana sebaka sa hao hore re fumane lefelo la bophelo bo botle le haufi.\n\nTobetsa konopo ya 📎 → Sebaka → Romela sebaka sa hao sa hajwale.',
    ts: '📍 Hi kombela u avelana ndhawu ya wena leswaku hi kuma ndhawu yo kufumela ya kusuhi.\n\nSindzisa bhatani ya 📎 → Ndhawu → Rhumela ndhawu ya wena ya sweswi.',
    ss: '📍 Sicela wabelane ngendzawo yakho sitewutfola indzawo yelatjhwa lesesedvuze.\n\nCindzetela inkinobho ye-📎 → Indzawo → Tfumela indzawo yakho yamanje.',
    ve: '📍 Ri humbela ni kovhele fhethu haṋu uri ri wane fhethu ha u alafhiwa hu re tsini.\n\nDindani bhatani ya 📎 → Fhethu → Rumelani fhethu haṋu ha zwino.',
    nr: '📍 Sibawa wabelane nendawo yakho bona sithole indawo yokulatjhwa eseduze.\n\nCindezela inkinobho ye-📎 → Indawo → Thumela indawo yakho yanje.'
  },

  // ==================== CHRONIC CONDITION SCREENING ====================
  chronic_screening: {
    en: `Before we continue, do you take medication for any of these conditions? (Reply with the numbers, e.g. "1,3" or "0" for none)

0. None
1. 💊 HIV / ARVs
2. 🩸 High blood pressure
3. 🍬 Diabetes (sugar)
4. ❤️ Heart condition
5. 🫁 Asthma / Lung condition
6. 🧠 Epilepsy
7. 💊 Other chronic medication`,

    zu: `Ngaphambi kokuthi siqhubeke, ingabe uthatha umuthi walezi zifo? (Phendula ngenombolo, isib. "1,3" noma "0" uma kungekho)

0. Lutho
1. 💊 HIV / Ama-ARV
2. 🩸 Igazi eliphakeme
3. 🍬 Ushukela (Diabetes)
4. ❤️ Isifo senhliziyo
5. 🫁 Isifuba / Iphaphu
6. 🧠 Isifo sokuwa (Epilepsy)
7. 💊 Omunye umuthi wamahlalakhona`,

    xh: `Phambi kokuba siqhubeke, ingaba uthatha amayeza ezi zifo? (Phendula ngenombolo, umz. "1,3" okanye "0" ukuba akukho)

0. Akukho
1. 💊 HIV / Ii-ARV
2. 🩸 Uxinzelelo lwegazi
3. 🍬 Iswekile (Diabetes)
4. ❤️ Isifo sentliziyo
5. 🫁 Isifuba / Imiphunga
6. 🧠 Isifo sokuwa (Epilepsy)
7. 💊 Esinye isigulo esinganyangekiyo`,

    af: `Voordat ons voortgaan, neem jy medikasie vir enige van hierdie toestande? (Antwoord met die nommers, bv. "1,3" of "0" vir geen)

0. Geen
1. 💊 MIV / ARV's
2. 🩸 Hoë bloeddruk
3. 🍬 Diabetes (suiker)
4. ❤️ Harttoestand
5. 🫁 Asma / Longtoestand
6. 🧠 Epilepsie
7. 💊 Ander chroniese medikasie`,

    nso: `Pele re tšwela pele, a o nwa dihlare tša malwetši a? (Araba ka dinomoro, mohlala "1,3" goba "0" ge e le gore ga go na)

0. Ga go na
1. 💊 HIV / Dihlare tša ARV
2. 🩸 Madi a go phagama
3. 🍬 Bolwetši bja swikiri
4. ❤️ Bolwetši bja pelo
5. 🫁 Sefuba / Maphephu
6. 🧠 Bolwetši bja go wa
7. 💊 Dihlare tše dingwe tša go se fole`,

    tn: `Pele re tswelela, a o nwa melemo ya malwetse a? (Araba ka dinomoro, sk. "1,3" kgotsa "0" fa go sena)

0. Ga go na
1. 💊 HIV / Melemo ya ARV
2. 🩸 Madi a kwa godimo
3. 🍬 Bolwetse jwa sukiri
4. ❤️ Bolwetse jwa pelo
5. 🫁 Sefuba / Matshwafo
6. 🧠 Bolwetse jwa go wa
7. 💊 Melemo e mengwe ya go sa fole`,

    st: `Pele re tswela pele, na o nwa dihlare tsa malwetse ana? (Araba ka dinomoro, mohlala "1,3" kapa "0" ha ho na)

0. Ha ho na
1. 💊 HIV / Dihlare tsa ARV
2. 🩸 Madi a phahameng
3. 🍬 Lefu la tsoekere
4. ❤️ Lefu la pelo
5. 🫁 Sefuba / Matshwafo
6. 🧠 Lefu la ho wa
7. 💊 Dihlare tse ding tsa malwetse a sa foleng`,

    ts: `Loko hi nga si ya emahlweni, xana u nwa mirhi ya mavabyi lama? (Hlamula hi tinomboro, xik. "1,3" kumbe "0" loko ku ri hava)

0. Ku hava
1. 💊 HIV / Mirhi ya ARV
2. 🩸 Ngati ya le henhla
3. 🍬 Vuvabyi bya xwikiri
4. ❤️ Vuvabyi bya mbilu
5. 🫁 Xifuva / Maphapha
6. 🧠 Vuvabyi bya ku wa
7. 💊 Mirhi yin'wana ya mavabyi ya ku nga heli`,

    ss: `Ngaphambi kwekutsi sichubeke, uyawanata yini emitsi yaletifo? (Phendvula ngetinombolo, sib. "1,3" noma "0" uma kungekho)

0. Kute
1. 💊 HIV / Ema-ARV
2. 🩸 Ingati lephakeme
3. 🍬 Sifo seswikili
4. ❤️ Sifo senhlitiyo
5. 🫁 Sifuba / Timphaphu
6. 🧠 Sifo sekuwa
7. 💊 Leminye imitsi yetifo letingapheli`,

    ve: `Phanḓa ha musi ri sa athu ya phanḓa, naa ni khou nwa mushonga wa malwadze aya? (Fhindulani nga dinomboro, tsumbo "1,3" kana "0" arali hu si na)

0. A hu na
1. 💊 HIV / Mushonga wa ARV
2. 🩸 Malofha a ṱhahani
3. 🍬 Vhulwadze ha swigiri
4. ❤️ Vhulwadze ha mbilu
5. 🫁 Tshifuva / Maṱhaha
6. 🧠 Vhulwadze ha u wa
7. 💊 Muṅwe mushonga wa vhulwadze vhu sa folaho`,

    nr: `Ngaphambi kobana siragele phambili, uyawasela na imitjhi yobulwelibu? (Phendula ngenomboro, isib. "1,3" namkha "0" uma kungekho)

0. Akukho
1. 💊 HIV / Ama-ARV
2. 🩸 Iingazi eziphezulu
3. 🍬 Isifo seswigiri
4. ❤️ Isifo senhliziyo
5. 🫁 Isifuba / Iphaphu
6. 🧠 Isifo sokuwa
7. 💊 Eminye imitjhi yeenzifo ezingapheliko`
  },

  chronic_screening_saved: {
    en: '✅ Thank you. This helps us give you better guidance.',
    zu: '✅ Siyabonga. Lokhu kusisiza sikunikeze iseluleko esingcono.',
    xh: '✅ Enkosi. Oku kusinceda sikunike iingcebiso ezingcono.',
    af: '✅ Dankie. Dit help ons om jou beter leiding te gee.',
    nso: '✅ Re a leboga. Se se re thuša go go fa maele a kaone.',
    tn: '✅ Re a leboga. Se se re thusa go go fa kgakololo e e botoka.',
    st: '✅ Re a leboha. Sena se re thusa ho u fa tataiso e ntle.',
    ts: '✅ Hi khensa. Leswi swi hi pfuna ku ku nyika switsundzuxo swo antswa.',
    ss: '✅ Siyabonga. Loku kusisita sikunikete teluleko lencono.',
    ve: '✅ Ri a livhuwa. Izwi ḽi ri thusa u ni ṋea vhulivhisi ha khwine.',
    nr: '✅ Siyathokoza. Lokhu kusisiza sikunikele isinqophiso esingcono.'
  },

  // ==================== IDENTITY CAPTURE ====================
  ask_first_name: {
    en: 'What is your first name? (As it appears on your ID)\n\nType your name:',
    zu: 'Ubani igama lakho? (Njengoba libhalwe ku-ID yakho)\n\nBhala igama lakho:',
    xh: 'Ngubani igama lakho? (Njengoko libhalwe kwi-ID yakho)\n\nBhala igama lakho:',
    af: 'Wat is jou voornaam? (Soos op jou ID)\n\nTik jou naam:',
    nso: 'Leina la gago ke mang? (Bjalo ka ge le ngwadilwe go ID ya gago)\n\nNgwala leina la gago:',
    tn: 'Leina la gago ke mang? (Jaaka le kwadilwe mo go ID ya gago)\n\nKwala leina la gago:',
    st: 'Lebitso la hao ke mang? (Jwaleka ha le ngotsweng ho ID ya hao)\n\nNgola lebitso la hao:',
    ts: 'Vito ra wena i mani? (Tanihileswi ri ngwaleke eka ID ya wena)\n\nTsala vito ra wena:',
    ss: 'Ngubani libito lakho? (Njengoba libhaliwe ku-ID yakho)\n\nBhala libito lakho:',
    ve: 'Dzina \u1e3daṋu ndi \u1e3difhio? (Sa zwine \u1e3da vha \u1e3do ṅwalwa kha ID yaṋu)\n\nṄwalani dzina \u1e3daṋu:',
    nr: 'Ngubani ibizo lakho? (Njengoba libhaliwe ku-ID yakho)\n\nTlola ibizo lakho:',
  },

  ask_surname: {
    en: (firstName) => `Thank you, *${firstName}*.\n\nWhat is your surname / family name?\n\nType your surname:`,
    zu: (firstName) => `Siyabonga, *${firstName}*.\n\nIsibongo sakho ubani?\n\nBhala isibongo sakho:`,
    xh: (firstName) => `Enkosi, *${firstName}*.\n\nFani yakho ngubani?\n\nBhala ifani yakho:`,
    af: (firstName) => `Dankie, *${firstName}*.\n\nWat is jou van?\n\nTik jou van:`,
    nso: (firstName) => `Re a leboga, *${firstName}*.\n\nSefane sa gago ke mang?\n\nNgwala sefane sa gago:`,
    tn: (firstName) => `Re a leboga, *${firstName}*.\n\nSefane sa gago ke mang?\n\nKwala sefane sa gago:`,
    st: (firstName) => `Re a leboha, *${firstName}*.\n\nFane ya hao ke mang?\n\nNgola fane ya hao:`,
    ts: (firstName) => `Hi khensa, *${firstName}*.\n\nXivongo xa wena i mani?\n\nTsala xivongo xa wena:`,
    ss: (firstName) => `Siyabonga, *${firstName}*.\n\nSibongo sakho ngubani?\n\nBhala sibongo sakho:`,
    ve: (firstName) => `Ri a livhuwa, *${firstName}*.\n\nTshina tsha haṋu ndi tshifhio?\n\nṄwalani tshina tsha haṋu:`,
    nr: (firstName) => `Siyathokoza, *${firstName}*.\n\nIsibongo sakho ngubani?\n\nTlola isibongo sakho:`,
  },

  ask_dob: {
    en: 'What is your date of birth?\n\nType it like this: *DD-MM-YYYY*\nExample: *15-03-1992*',
    zu: 'Usuku lwakho lokuzalwa luyini?\n\nBhala kanje: *DD-MM-YYYY*\nIsibonelo: *15-03-1992*',
    xh: 'Umhla wakho wokuzalwa ngowuphi?\n\nBhala ngolu hlobo: *DD-MM-YYYY*\nUmzekelo: *15-03-1992*',
    af: 'Wat is jou geboortedatum?\n\nTik dit so: *DD-MM-YYYY*\nVoorbeeld: *15-03-1992*',
    nso: 'Letšatšikgwedi la gago la matswalo ke lefe?\n\nNgwala ka tsela ye: *DD-MM-YYYY*\nMohlala: *15-03-1992*',
    tn: 'Letsatsi la gago la matsalo ke lefe?\n\nKwala ka tsela e: *DD-MM-YYYY*\nSekai: *15-03-1992*',
    st: 'Letsatsi la hao la tswalo ke lefe?\n\nNgola ka tsela ena: *DD-MM-YYYY*\nMohlala: *15-03-1992*',
    ts: 'Siku ra wena ro velekiwa hi rini?\n\nTsala hi ndlela leyi: *DD-MM-YYYY*\nXikombiso: *15-03-1992*',
    ss: 'Lusuku lwakho lwekutalwa luyini?\n\nBhala kanje: *DD-MM-YYYY*\nSibonelo: *15-03-1992*',
    ve: 'Ḓuvha \u1e3daṋu \u1e3da mabebo ndi \u1e3difhio?\n\nṄwalani nga nḓila iyi: *DD-MM-YYYY*\nTsumbo: *15-03-1992*',
    nr: 'Ilanga lakho lokubelethwa liyini?\n\nTlola ngalendlela: *DD-MM-YYYY*\nIsibonelo: *15-03-1992*',
  },

  ask_sex: {
    en: 'What is your sex?\n\n1 — Male\n2 — Female\n3 — Intersex\n4 — Prefer not to say',
    zu: 'Ubulili bakho yini?\n\n1 — Owesilisa\n2 — Owesifazane\n3 — Intersex\n4 — Angithandi ukusho',
    xh: 'Isini sakho siyintoni?\n\n1 — Indoda\n2 — Ibhinqa\n3 — Intersex\n4 — Andifuni ukutsho',
    af: 'Wat is jou geslag?\n\n1 — Manlik\n2 — Vroulik\n3 — Interseks\n4 — Verkies om nie te sê nie',
    nso: 'Bong ba gago ke eng?\n\n1 — Monna\n2 — Mosadi\n3 — Intersex\n4 — Ga ke nyake go bolela',
    tn: 'Bong jwa gago ke eng?\n\n1 — Monna\n2 — Mosadi\n3 — Intersex\n4 — Ga ke batle go bolela',
    st: 'Boleng ba hao ke eng?\n\n1 — Monna\n2 — Mosadi\n3 — Intersex\n4 — Ha ke batle ho bolela',
    ts: 'Rimbewu ra wena i yini?\n\n1 — Wanuna\n2 — Wansati\n3 — Intersex\n4 — A ndzi lavi ku vula',
    ss: 'Bulili bakho buyini?\n\n1 — Lomdvuna\n2 — Lomfati\n3 — Intersex\n4 — Angitsandzi kusho',
    ve: 'Mbeu yaṋu ndi ifhio?\n\n1 — Munna\n2 — Musadzi\n3 — Intersex\n4 — A thi ṱoḓi u amba',
    nr: 'Ubulili bakho buyini?\n\n1 — Indoda\n2 — Umfazi\n3 — Intersex\n4 — Angifuni ukutjho',
  },

  identity_confirmed: {
    en: (name, surname) => `✅ Thank you, *${name} ${surname}*. This helps the clinic prepare your file before you arrive.`,
    zu: (name, surname) => `✅ Siyabonga, *${name} ${surname}*. Lokhu kusiza umtholampilo ulungise ifayela lakho ngaphambi kokuthi ufike.`,
    xh: (name, surname) => `✅ Enkosi, *${name} ${surname}*. Oku kunceda ikliniki ilungise ifayile yakho phambi kokuba ufike.`,
    af: (name, surname) => `✅ Dankie, *${name} ${surname}*. Dit help die kliniek om jou l\u00EAer voor te berei voor jy aankom.`,
    nso: (name, surname) => `✅ Re a leboga, *${name} ${surname}*. Se se thuša kiliniki go lokišetša faele ya gago pele o fihla.`,
    tn: (name, surname) => `✅ Re a leboga, *${name} ${surname}*. Se se thusa kliniki go baakanya faele ya gago pele o goroga.`,
    st: (name, surname) => `✅ Re a leboha, *${name} ${surname}*. Sena se thusa kliniki ho lokisetsa faele ya hao pele o fihla.`,
    ts: (name, surname) => `✅ Hi khensa, *${name} ${surname}*. Leswi swi pfuna kliniki ku lulamisa fayili ya wena u nga si fika.`,
    ss: (name, surname) => `✅ Siyabonga, *${name} ${surname}*. Loku kusita ikliniki ilungise ifayili yakho ungakefiki.`,
    ve: (name, surname) => `✅ Ri a livhuwa, *${name} ${surname}*. Izwi \u1e3di thusa kiliniki u lugisa faela yaṋu ni sa athu u swika.`,
    nr: (name, surname) => `✅ Siyathokoza, *${name} ${surname}*. Lokhu kusiza ikliniki ilungiselele ifayili yakho ungakafiki.`,
  },

  // ==================== RETURNING VS NEW PATIENT ====================
  ask_returning: {
    en: (facilityName) => `Have you been to *${facilityName}* before?\n\n1 — Yes, I have a file there\n2 — No, this is my first visit\n3 — I'm not sure`,
    zu: (facilityName) => `Ingabe uke waya ku-*${facilityName}* ngaphambili?\n\n1 — Yebo, nginefayela khona\n2 — Cha, ngivakashela okokuqala\n3 — Angiqiniseki`,
    xh: (facilityName) => `Ingaba ukhe waya ku-*${facilityName}* ngaphambili?\n\n1 — Ewe, ndinefayile apho\n2 — Hayi, yindwendwelo yam yokuqala\n3 — Andiqinisekanga`,
    af: (facilityName) => `Was jy al voorheen by *${facilityName}*?\n\n1 — Ja, ek het 'n l\u00EAer daar\n2 — Nee, dit is my eerste besoek\n3 — Ek is nie seker nie`,
    nso: (facilityName) => `A o kile wa ya go *${facilityName}* peleng?\n\n1 — Ee, ke na le faele moo\n2 — Aowa, ke ketelo ya ka ya mathomo\n3 — Ga ke na bonnete`,
    tn: (facilityName) => `A o kile wa ya kwa *${facilityName}* pele?\n\n1 — Ee, ke na le faele koo\n2 — Nnyaa, ke ketelo ya me ya ntlha\n3 — Ga ke na bonnete`,
    st: (facilityName) => `Na o kile wa ya ho *${facilityName}* pele?\n\n1 — E, ke na le faele moo\n2 — Tjhe, ke ketelo ya ka ya pele\n3 — Ha ke na bonnete`,
    ts: (facilityName) => `Xana u tshame u ya eka *${facilityName}* khale?\n\n1 — Ina, ndzi na fayili kwalaho\n2 — Ee-ee, ku endzela ka mina ko sungula\n3 — A ndzi tiyiseki`,
    ss: (facilityName) => `Sewuke waya ku-*${facilityName}* ngaphambilini?\n\n1 — Yebo, nginefayili lapho\n2 — Cha, kuvakashela kwami kwekucala\n3 — Angikacini`,
    ve: (facilityName) => `Naa no ṱalela kha *${facilityName}* kale?\n\n1 — Ee, ndi na faela henefho\n2 — Hai, ndi u dalela hanga ha u thoma\n3 — A thi na vhungoho`,
    nr: (facilityName) => `Sewuke waya ku-*${facilityName}* ngaphambilini?\n\n1 — Iye, nginefayili lapho\n2 — Awa, kuvakathela kwami kokuthoma\n3 — Angikaqiniseki`,
  },

  returning_yes: {
    en: '📁 Good — the clinic will look for your file before you arrive.',
    zu: '📁 Kuhle — umtholampilo uzofuna ifayela lakho ngaphambi kokuthi ufike.',
    xh: '📁 Kulungile — ikliniki iza kukhangela ifayile yakho phambi kokuba ufike.',
    af: '📁 Goed — die kliniek sal jou l\u00EAer soek voor jy aankom.',
    nso: '📁 Go botse — kiliniki e tla nyaka faele ya gago pele o fihla.',
    tn: '📁 Go siame — kliniki e tla batla faele ya gago pele o goroga.',
    st: '📁 Ho lokile — kliniki e tla batla faele ya hao pele o fihla.',
    ts: '📁 Swa saseka — kliniki yi ta lava fayili ya wena u nga si fika.',
    ss: '📁 Kuhle — ikliniki itawufuna ifayili yakho ungakefiki.',
    ve: '📁 Ndi zwavhuḓi — kiliniki i ḓo ṱoḓa faela yaṋu ni sa athu u swika.',
    nr: '📁 Kuhle — ikliniki izakufuna ifayili yakho ungakafiki.',
  },

  returning_new: {
    en: '🆕 No problem — the clinic will create a new file for you. This saves time when you arrive.',
    zu: '🆕 Akukho nkinga — umtholampilo uzokwenza ifayela elisha. Lokhu kongela isikhathi uma ufika.',
    xh: '🆕 Akukho ngxaki — ikliniki iza kwenza ifayile entsha. Oku kongela ixesha xa ufika.',
    af: '🆕 Geen probleem — die kliniek sal \'n nuwe l\u00EAer skep. Dit bespaar tyd wanneer jy aankom.',
    nso: '🆕 Ga go bothata — kiliniki e tla dira faele ye mpsha. Se se boloka nako ge o fihla.',
    tn: '🆕 Ga go bothata — kliniki e tla dira faele e ntšhwa. Se se boloka nako fa o goroga.',
    st: '🆕 Ha ho bothata — kliniki e tla etsa faele e ncha. Sena se boloka nako ha o fihla.',
    ts: '🆕 Ku hava xiphiqo — kliniki yi ta endla fayili leyintshwa. Leswi swi hlayisa nkarhi loko u fika.',
    ss: '🆕 Kute inkinga — ikliniki itakwenta ifayili lensha. Loku kongela sikhatsi nawufika.',
    ve: '🆕 A hu na thaidzo — kiliniki i ḓo ita faela ntswa. Izwi \u1e3di vhulungela tshifhinga musi ni tshi swika.',
    nr: '🆕 Akukho ikinga — ikliniki izakwenza ifayili etja. Lokhu kusindisa isikhathi nawufika.',
  },

  returning_unsure: {
    en: '📋 No problem. The clinic will check when you arrive. Your name and date of birth will help them find your file quickly.',
    zu: '📋 Akukho nkinga. Umtholampilo uzohlola uma ufika. Igama lakho nosuku lokuzalwa kuzosiza bakuthole ifayela ngokushesha.',
    xh: '📋 Akukho ngxaki. Ikliniki iza kukhangela xa ufika. Igama lakho nomhla wokuzalwa kuya kunceda bafumane ifayile ngokukhawuleza.',
    af: '📋 Geen probleem. Die kliniek sal kontroleer wanneer jy aankom. Jou naam en geboortedatum sal hulle help om jou l\u00EAer vinnig te vind.',
    nso: '📋 Ga go bothata. Kiliniki e tla lekola ge o fihla. Leina la gago le letšatšikgwedi la matswalo di tla ba thuša go hwetša faele ya gago ka pela.',
    tn: '📋 Ga go bothata. Kliniki e tla tlhola fa o goroga. Leina la gago le letsatsi la matsalo di tla ba thusa go bona faele ya gago ka bonako.',
    st: '📋 Ha ho bothata. Kliniki e tla hlahloba ha o fihla. Lebitso la hao le letsatsi la tswalo di tla ba thusa ho fumana faele ya hao kapele.',
    ts: '📋 Ku hava xiphiqo. Kliniki yi ta kambela loko u fika. Vito ra wena na siku ro velekiwa swi ta va pfuna ku kuma fayili ya wena hi ku hatlisa.',
    ss: '📋 Kute inkinga. Ikliniki itahlola nawufika. Libito lakho nelusuku lwekutalwa kutawubasita batfole ifayili yakho masinyane.',
    ve: '📋 A hu na thaidzo. Kiliniki i ḓo sedza musi ni tshi swika. Dzina \u1e3daṋu na ḓuvha \u1e3da mabebo zwi ḓo vha thusa u wana faela yaṋu nga u ṱavhanya.',
    nr: '📋 Akukho ikinga. Ikliniki izakuhlola nawufika. Ibizo lakho nelanga lokubelethwa kuzabasiza bafumane ifayili yakho msinyana.',
  },

  // ==================== STUDY PARTICIPATION ====================
  study_participation: {
    en: `Are you taking part in the BIZUSIZO research study at a clinic?

1 \u2014 Yes, I am a study participant
2 \u2014 No, I am just using BIZUSIZO for myself`,

    zu: `Ingabe uyahlanganyela ocwaningweni lwe-BIZUSIZO emtholampilo?

1 \u2014 Yebo, ngingumhlanganyeli wocwaningo
2 \u2014 Cha, ngisebenzisa i-BIZUSIZO nje`,

    xh: `Ingaba uthatha inxaxheba kuphando lwe-BIZUSIZO ekliniki?

1 \u2014 Ewe, ndingumthathi-nxaxheba wophando
2 \u2014 Hayi, ndisebenzisa i-BIZUSIZO nje`,

    af: `Neem jy deel aan die BIZUSIZO-navorsingstudie by 'n kliniek?

1 \u2014 Ja, ek is 'n studiedeelnemer
2 \u2014 Nee, ek gebruik BIZUSIZO net vir myself`,

    nso: `A o tšea karolo ka dinyakišišong tša BIZUSIZO kiliniki?

1 \u2014 Ee, ke motšeakarolo wa dinyakišišo
2 \u2014 Aowa, ke šomiša BIZUSIZO fela`,

    tn: `A o tsaya karolo mo patlisisong ya BIZUSIZO kwa kliniki?

1 \u2014 Ee, ke motsayakarolo wa patlisiso
2 \u2014 Nnyaa, ke dirisa BIZUSIZO fela`,

    st: `Na o nka karolo dipatlisisong tsa BIZUSIZO kliniki?

1 \u2014 E, ke monkakarolo wa dipatlisiso
2 \u2014 Tjhe, ke sebedisa BIZUSIZO feela`,

    ts: `Xana u teka xiave eka ndzavisiso wa BIZUSIZO ekliniki?

1 \u2014 Ina, ndzi muteki-xiave wa ndzavisiso
2 \u2014 Ee-ee, ndzi tirhisa BIZUSIZO ntsena`,

    ss: `Uyahlanganyela yini kulucwaningo lwe-BIZUSIZO ekliniki?

1 \u2014 Yebo, ngingumhlanganyeli welucwaningo
2 \u2014 Cha, ngisebentisa i-BIZUSIZO nje`,

    ve: `Naa ni khou shela mulenzhe kha \u1e71hoḓisiso ya BIZUSIZO kiliniki?

1 \u2014 Ee, ndi mushelamulenzhe wa \u1e71hoḓisiso
2 \u2014 Hai, ndi khou shumisa BIZUSIZO fhedzi`,

    nr: `Uyahlanganyela na kurhubhululo lwe-BIZUSIZO ekliniki?

1 \u2014 Iye, ngingumhlanganyeli werhubhululo
2 \u2014 Awa, ngisebenzisa i-BIZUSIZO kwaphela`
  },

  // ==================== STUDY CODE ====================
  study_code: {
    en: (code) => `🔢 Your study code is: *${code}*\n\nPlease show this code to the research assistant when you arrive at the clinic. It helps us link your BIZUSIZO triage to your clinic visit.\n\nYou can also type "code" at any time to see your code again.`,
    zu: (code) => `🔢 Ikhodi yakho yocwaningo ithi: *${code}*\n\nSicela ukhombise le khodi kumcwaningi uma ufika emtholampilo. Isisiza sixhumanise i-triage yakho ye-BIZUSIZO nokuvakatshela kwakho emtholampilo.\n\nUngabhala "code" noma nini ukubona ikhodi yakho futhi.`,
    xh: (code) => `🔢 Ikhowudi yakho yophando ithi: *${code}*\n\nNceda ubonise le khowudi kumphandi xa ufika ekliniki. Isinceda sidibanise i-triage yakho ye-BIZUSIZO notyelelo lwakho ekliniki.\n\nUngabhala "code" nanini na ukubona ikhowudi yakho kwakhona.`,
    af: (code) => `🔢 Jou studiekode is: *${code}*\n\nWys asseblief hierdie kode aan die navorsingsassistent wanneer jy by die kliniek aankom. Dit help ons om jou BIZUSIZO-triage aan jou kliniekbesoek te koppel.\n\nJy kan ook enige tyd "code" tik om jou kode weer te sien.`,
    nso: (code) => `🔢 Khoutu ya gago ya dinyakišišo ke: *${code}*\n\nHle bontšha khoutu ye go monyakišiši ge o fihla kiliniki. E re thuša go hokaganya triage ya gago ya BIZUSIZO le go etela ga gago kiliniki.\n\nO ka ngwala "code" nako efe goba efe go bona khoutu ya gago gape.`,
    tn: (code) => `🔢 Khoutu ya gago ya patlisiso ke: *${code}*\n\nTswee-tswee bontsha khoutu e go mmatlisisi fa o goroga kliniki. E re thusa go golaganya triage ya gago ya BIZUSIZO le go etela ga gago kliniki.\n\nO ka kwala "code" nako nngwe le nngwe go bona khoutu ya gago gape.`,
    st: (code) => `🔢 Khoutu ya hao ya dipatlisiso ke: *${code}*\n\nKa kopo bontsha khoutu ena ho mofuputsi ha o fihla kliniki. E re thusa ho hokahanya triage ya hao ya BIZUSIZO le ketelo ya hao kliniki.\n\nO ka ngola "code" nako efe kapa efe ho bona khoutu ya hao hape.`,
    ts: (code) => `🔢 Khodi ya wena ya ndzavisiso i ri: *${code}*\n\nHi kombela u kombisa khodi leyi eka mulavisisi loko u fika ekliniki. Yi hi pfuna ku hlanganisa triage ya wena ya BIZUSIZO na ku endzela ka wena ekliniki.\n\nU nga tsala "code" nkarhi wun'wana na wun'wana ku vona khodi ya wena nakambe.`,
    ss: (code) => `🔢 Ikhodi yakho yekucwaninga itsi: *${code}*\n\nSicela ukhombise lekhodi kumcwaningi nawufika ekliniki. Isisita sihlanganise i-triage yakho ye-BIZUSIZO nekuvakashela kwakho ekliniki.\n\nUngabhala "code" nanoma nini kubona ikhodi yakho futsi.`,
    ve: (code) => `🔢 Khoudu yaṋu ya ṱhoḓisiso ndi: *${code}*\n\nRi humbela ni sumbedze khoudu iyi kha muṱoḓisisi musi ni tshi swika kiliniki. I ri thusa u ṱanganya triage yaṋu ya BIZUSIZO na u dalela haṋu kiliniki.\n\nNi nga ṅwala "code" tshifhinga tshiṅwe na tshiṅwe u vhona khoudu yaṋu hafhu.`,
    nr: (code) => `🔢 Ikhodi yakho yerhubhululo ithi: *${code}*\n\nSibawa ukhombise lekhodi kumrhubhululi nawufika ekliniki. Isisiza sihlanganise i-triage yakho ye-BIZUSIZO nekuvakatjhela kwakho ekliniki.\n\nUngatlola "code" nanini ukubona ikhodi yakho godu.`
  },

  // ==================== CATEGORY FOLLOW-UP ====================
  category_detail_prompt: {
    en: (category) => `You selected: *${category}*\n\nHow bad is it?\n1 — Mild (I can do my daily activities)\n2 — Moderate (it's affecting my daily activities)\n3 — Severe (I can barely function)\n\nOr type your symptoms in your own words.\nYou can also send a voice note 🎤`,
    zu: (category) => `Ukhethe: *${category}*\n\nKumbi kangakanani?\n1 — Kancane (ngingenza imisebenzi yami yansuku zonke)\n2 — Maphakathi (kuthinta imisebenzi yami)\n3 — Kakhulu (angikwazi nhlobo)\n\nNoma uchaze izimpawu zakho ngamazwi akho.\nUngathuma ivoice note 🎤`,
    xh: (category) => `Ukhethe: *${category}*\n\nKumbi kangakanani?\n1 — Kancinane (ndingenza imisebenzi yam yemihla ngemihla)\n2 — Maphakathi (kuchaphazela imisebenzi yam)\n3 — Kakhulu (andikwazi kwaphela)\n\nOkanye uchaze iimpawu zakho ngamazwi akho.\nUngathuma ivoice note 🎤`,
    af: (category) => `Jy het gekies: *${category}*\n\nHoe erg is dit?\n1 — Lig (ek kan my daaglikse aktiwiteite doen)\n2 — Matig (dit affekteer my daaglikse aktiwiteite)\n3 — Ernstig (ek kan skaars funksioneer)\n\nOf beskryf jou simptome in jou eie woorde.\nJy kan ook \'n stemnota stuur 🎤`,
    nso: (category) => `O kgethile: *${category}*\n\nGo mpe gakaakang?\n1 — Gannyane (nka dira mediro ya ka ya tšatši le lengwe le le lengwe)\n2 — Magareng (go ama mediro ya ka)\n3 — Kudu (nka se kgone ka tsela)\n\nGoba hlaloša dika tša gago ka mantšu a gago.\nO ka romela voice note 🎤`,
    tn: (category) => `O tlhophile: *${category}*\n\nGo maswe go le kana kang?\n1 — Bonnye (nka dira ditiro tsa ka tsa letsatsi le letsatsi)\n2 — Magareng (go ama ditiro tsa ka)\n3 — Thata (nka se kgone gotlhelele)\n\nKgotsa tlhalosa matshwao a gago ka mafoko a gago.\nO ka romela voice note 🎤`,
    st: (category) => `O kgethile: *${category}*\n\nHo mpe hakaakang?\n1 — Hanyane (nka etsa mesebetsi ya ka ya letsatsi le letsatsi)\n2 — Mahareng (ho ama mesebetsi ya ka)\n3 — Haholo (nka se tsebe ho sebetsa)\n\nKapa hlalosa matshwao a hao ka mantswe a hao.\nO ka romela voice note 🎤`,
    ts: (category) => `U hlawule: *${category}*\n\nSwi bihile ku fikela kwihi?\n1 — Swi nyane (ndzi nga endla mintirho ya mina ya siku na siku)\n2 — Swi ringana (swi khumbha mintirho ya mina)\n3 — Swi tika (a ndzi koti na swintsongo)\n\nKumbe u hlamusela swikombiso swa wena hi marito ya wena.\nU nga rhumela voice note 🎤`,
    ss: (category) => `Ukhetse: *${category}*\n\nKumbi kangakanani?\n1 — Kancane (ngingenta imisebenti yami yemalanga onkhe)\n2 — Emkhatsini (iyangiphazamisa)\n3 — Kakhulu (angikwati kutenta lutfo)\n\nNoma uchaze timphawu takho ngamagama akho.\nUngathuma voice note 🎤`,
    ve: (category) => `No nanga: *${category}*\n\nZwi vhavha hani?\n1 — Zwiṱuku (ndi a kona u ita mishumo yanga ya ḓuvha na ḓuvha)\n2 — Vhukati (zwi khou kwama mishumo yanga)\n3 — Vhukuma (a thi koni na luthihi)\n\nKana ni ṱalutshedze zwiga zwaṋu nga maipfi aṋu.\nNi nga rumela voice note 🎤`,
    nr: (category) => `Ukhethe: *${category}*\n\nKumbi kangangani?\n1 — Kancani (ngingenza imisebenzi yami yemalanga)\n2 — Maphakathi (iyangithinta imisebenzi yami)\n3 — Khulu (angikghoni ukwenza litho)\n\nNamkha uchaze iimpawu zakho ngamagama wakho.\nUngathuma voice note 🎤`
  },

  // ==================== VOICE NOTE PROMPT ====================
  voice_note_prompt: {
    en: '🎤 You can send a voice note describing your symptoms. Speak clearly and tell us:\n\n• What is wrong\n• When it started\n• How bad it is\n\nWe will listen to your message and help you.',
    zu: '🎤 Ungathuma ivoice note uchaze izimpawu zakho. Khuluma ngokucacile usitshele:\n\n• Kwenzakalani\n• Kuqale nini\n• Kumbi kangakanani\n\nSizolalela umyalezo wakho sikusize.',
    xh: '🎤 Ungathumela ivoice note uchaze iimpawu zakho. Thetha ngokucacileyo usixelele:\n\n• Kwenzeka ntoni\n• Kuqale nini\n• Kumbi kangakanani\n\nSiya kuwumamela umyalezo wakho sikuncede.',
    af: '🎤 Jy kan \'n stemnota stuur wat jou simptome beskryf. Praat duidelik en vertel ons:\n\n• Wat is fout\n• Wanneer het dit begin\n• Hoe erg is dit\n\nOns sal na jou boodskap luister en jou help.',
    nso: '🎤 O ka romela voice note o hlaloša dika tša gago. Bolela gabotse o re botše:\n\n• Go direga eng\n• Go thomile neng\n• Go mpe gakaakang\n\nRe tla theetša molaetša wa gago re go thuše.',
    tn: '🎤 O ka romela voice note o tlhalosa matshwao a gago. Bua sentle o re bolelele:\n\n• Go diragala eng\n• Go simolotse leng\n• Go maswe go le kana kang\n\nRe tla reetsa molaetsa wa gago re go thuse.',
    st: '🎤 O ka romela voice note o hlalosa matshwao a hao. Bua hantle o re bolelle:\n\n• Ho etsahalang\n• Ho qalile neng\n• Ho mpe hakaakang\n\nRe tla mamela molaetsa wa hao re o thuse.',
    ts: '🎤 U nga rhumela voice note u hlamusela swikombiso swa wena. Vulavula kahle u hi byela:\n\n• Ku humelela yini\n• Ku sungule rini\n• Ku bihile ku fikela kwihi\n\nHi ta yingisela mahungu ya wena hi ku pfuna.',
    ss: '🎤 Ungathuma voice note uchaza timphawu takho. Khuluma kahle usitjele:\n\n• Kwentekani\n• Kuchale nini\n• Kumbi kangakanani\n\nSitalilalela umyalezo wakho sikusite.',
    ve: '🎤 Ni nga rumela voice note ni tshi ṱalutshedza zwiga zwaṋu. Ambelani zwavhuḓi ni ri vhudze:\n\n• Hu khou itea mini\n• Zwo thoma lini\n• Zwi vhavha hani\n\nRi ḓo thetshelesa mulaedza waṋu ri ni thuse.',
    nr: '🎤 Ungathumela voice note uchaza iimpawu zakho. Khuluma kuhle usitjele:\n\n• Kwenzekani\n• Kuthome nini\n• Kumbi kangangani\n\nSizakulalela umlayezo wakho sikusize.'
  },

  // ==================== VOICE NOTE RECEIVED ====================
  voice_note_received: {
    en: '🎤 Voice note received. Let me process your message...',
    zu: '🎤 Ivoice note itholakele. Ake ngicubungule umyalezo wakho...',
    xh: '🎤 Ivoice note ifunyenwe. Mandiqwalasele umyalezo wakho...',
    af: '🎤 Stemnota ontvang. Laat ek jou boodskap verwerk...',
    nso: '🎤 Voice note e amogetšwe. Eka ke šome molaetša wa gago...',
    tn: '🎤 Voice note e amogetšwe. A ke dire molaetsa wa gago...',
    st: '🎤 Voice note e amohelehile. Ha ke sebetse molaetsa wa hao...',
    ts: '🎤 Voice note yi amukelekile. A ndzi tirhe mahungu ya wena...',
    ss: '🎤 Voice note itfolakele. Angisebente umlayezo wakho...',
    ve: '🎤 Voice note yo ṱanganedzwa. Kha ndi shumise mulaedza waṋu...',
    nr: '🎤 Voice note itholakele. Angisebenze umlayezo wakho...'
  },

  // ==================== THINKING INDICATOR ====================
  // Sent immediately when symptoms are received, before the AI processes.
  // Gives the patient feedback that the system is working — prevents
  // the "is this thing on?" feeling during the 2-5 second AI call.
  thinking: {
    en: '🔍 Assessing your symptoms...',
    zu: '🔍 Sihlola izimpawu zakho...',
    xh: '🔍 Sihlola iimpawu zakho...',
    af: '🔍 Ons assesseer jou simptome...',
    nso: '🔍 Re lekola dika tša gago...',
    tn: '🔍 Re sekaseka matshwao a gago...',
    st: '🔍 Re hlahloba matshwao a hao...',
    ts: '🔍 Hi kambela swikombiso swa wena...',
    ss: '🔍 Sihlola timphawu takho...',
    ve: '🔍 Ri khou sedzulusa zwiga zwaṋu...',
    nr: '🔍 Sihlola iimpawu zakho...'
  },

  // ==================== HELPFUL TIPS ====================
  // Sent after triage results so the patient knows how to navigate
  tips: {
    en: '\n💡 *Tips:*\nType *0* — new consultation\nType *language* — change language\nType *code* — show your reference number',
    zu: '\n💡 *Amathiphu:*\nBhala *0* — ukuxoxa okusha\nBhala *ulimi* — shintsha ulimi\nBhala *code* — khombisa inombolo yakho',
    xh: '\n💡 *Amathiphu:*\nBhala *0* — incoko entsha\nBhala *ulwimi* — tshintsha ulwimi\nBhala *code* — bonisa inombolo yakho',
    af: '\n💡 *Wenke:*\nTik *0* — nuwe konsultasie\nTik *taal* — verander taal\nTik *code* — wys jou verwysingsnommer',
    nso: '\n💡 *Maele:*\nNgwala *0* — poledišano ye mpsha\nNgwala *polelo* — fetola polelo\nNgwala *code* — bontšha nomoro ya gago',
    tn: '\n💡 *Maele:*\nKwala *0* — puisano e ntšhwa\nKwala *puo* — fetola puo\nKwala *code* — bontsha nomoro ya gago',
    st: '\n💡 *Maele:*\nNgola *0* — puisano e ncha\nNgola *puo* — fetola puo\nNgola *code* — bontsha nomoro ya hao',
    ts: '\n💡 *Switsundzuxo:*\nTsala *0* — nkani leyintshwa\nTsala *ririmi* — cinca ririmi\nTsala *code* — kombisa nomboro ya wena',
    ss: '\n💡 *Ema-thiphu:*\nBhala *0* — ingcoco lensha\nBhala *lulwimi* — shintja lulwimi\nBhala *code* — khombisa inombolo yakho',
    ve: '\n💡 *Nyeletshedzo:*\nṄwalani *0* — nyambedzano ntswa\nṄwalani *luambo* — shandukani luambo\nṄwalani *code* — sumbedzani nomboro yaṋu',
    nr: '\n💡 *Amathiphu:*\nTlola *0* — ingcoco etja\nTlola *ilimi* — tjhentjha ilimi\nTlola *code* — khombisa inomboro yakho'
  },

  // ==================== SYSTEM TIMEOUT / OUTAGE FALLBACK ====================
  // Sent when the system cannot process a message within 15 seconds
  // (load shedding, Railway outage, Supabase downtime, etc.)
  // Advises BOTH calling 10177 AND going to nearest clinic/hospital
  // because ambulance response in many SA areas is unreliable.
  rate_limited: {
    en: '⏳ You\'ve sent a lot of messages in a short time. Please wait a few minutes before trying again.\n\n🚨 *If this is an emergency:*\n• Call *10177* (ambulance) or *084 124* (ER24)\n• Go to your nearest clinic or hospital immediately',
    zu: '⏳ Uthumele imilayezo eminingi ngesikhathi esifushane. Sicela ulinde imizuzu embalwa bese uzama futhi.\n\n🚨 *Uma kuphuthumile:*\n• Shaya *10177* (i-ambulensi) noma *084 124* (ER24)\n• Yana emtholampilo noma esibhedlela esiseduze',
    xh: '⏳ Uthumele imiyalezo emininzi ngexesha elifutshane. Nceda linda imizuzu embalwa uze uzame kwakhona.\n\n🚨 *Ukuba yingxakeko:*\n• Tsalela *10177* (i-ambulensi) okanye *084 124* (ER24)\n• Yiya ekliniki okanye esibhedlele esikufutshane',
    af: '⏳ Jy het baie boodskappe in \'n kort tyd gestuur. Wag asseblief \'n paar minute voordat jy weer probeer.\n\n🚨 *As dit \'n noodgeval is:*\n• Bel *10177* (ambulans) of *084 124* (ER24)\n• Gaan na jou naaste kliniek of hospitaal',
  },

  system_timeout: {
    en: '⚠️ We are experiencing technical difficulties and cannot process your message right now.\n\n🚨 *If this is an emergency:*\n• Call *10177* (ambulance) or *084 124* (ER24)\n• Go to your nearest clinic or hospital immediately — do not wait for an ambulance\n\nWe will try to respond as soon as the system is back. We apologise for the inconvenience.',
    zu: '⚠️ Sinezinkinga zobuchwepheshe futhi asikwazi ukucubungula umyalezo wakho okwamanje.\n\n🚨 *Uma kuphuthumile:*\n• Shaya *10177* (i-ambulensi) noma *084 124* (ER24)\n• Yana emtholampilo noma esibhedlela esiseduze MANJE — ungalindi i-ambulensi\n\nSizozama ukuphendula uma uhlelo selubuyile. Siyaxolisa ngokuphazamiseka.',
    xh: '⚠️ Sinengxaki yobuchwepheshe kwaye asikwazi ukucubungula umyalezo wakho okwangoku.\n\n🚨 *Ukuba yingxakeko:*\n• Tsalela *10177* (i-ambulensi) okanye *084 124* (ER24)\n• Yiya ekliniki okanye esibhedlele esikufutshane NGOKU — musa ukulinda i-ambulensi\n\nSiza kuzama ukuphendula xa inkqubo ibuyile. Siyaxolisa ngokuphazamisa.',
    af: '⚠️ Ons ondervind tegniese probleme en kan nie jou boodskap nou verwerk nie.\n\n🚨 *As dit \'n noodgeval is:*\n• Bel *10177* (ambulans) of *084 124* (ER24)\n• Gaan na jou naaste kliniek of hospitaal DADELIK — moenie wag vir \'n ambulans nie\n\nOns sal probeer antwoord sodra die stelsel terug is. Ons vra om verskoning.',
    nso: '⚠️ Re itemogela mathata a theknolotši gomme re ka se kgone go šoma molaetša wa gago ga bjale.\n\n🚨 *Ge e le tšhoganetšo:*\n• Leletša *10177* (ambulense) goba *084 124* (ER24)\n• Yaa kiliniki goba sepetleleng sa kgauswi BJALE — o se ke wa ema ambulense\n\nRe tla leka go araba ge tshepedišo e bušitšwe. Re kgopela tshwarelo.',
    tn: '⚠️ Re itemogela mathata a thekenoloji mme re ka se kgone go dira molaetsa wa gago jaanong.\n\n🚨 *Fa e le tshoganyetso:*\n• Leletsa *10177* (ambulense) kgotsa *084 124* (ER24)\n• Ya kliniki kgotsa bookelong jo bo gaufi JAANONG — o se ka wa ema ambulense\n\nRe tla leka go araba fa tshedimosetso e boetse. Re kopa maitshwarelo.',
    st: '⚠️ Re itemohela mathata a theknoloji mme re ke ke ra sebetsa molaetsa wa hao hona joale.\n\n🚨 *Haeba ke tshohanyetso:*\n• Letsetsa *10177* (ambulense) kapa *084 124* (ER24)\n• Eya kliniki kapa sepetlele se haufi HONA JOALE — o se ke oa ema ambulense\n\nRe tla leka ho araba ha sistimi e boeile. Re kopa tshwarelo.',
    ts: '⚠️ Hi kumile swiphiqo swa thekinoloji naswona a hi koti ku tirha mahungu ya wena sweswi.\n\n🚨 *Loko ku ri xihatla:*\n• Ringela *10177* (ambulense) kumbe *084 124* (ER24)\n• Famba u ya ekliniki kumbe exibedlhele xa kusuhi SWESWI — u nga yimi ambulense\n\nHi ta ringeta ku hlamula loko sisiteme yi vuyile. Hi kombela ku khomela.',
    ss: '⚠️ Sinenkinga yebuchwepheshe futsi asikwati kusebenta umlayezo wakho nyalo.\n\n🚨 *Uma kusheshisa:*\n• Shayela *10177* (i-ambulensi) noma *084 124* (ER24)\n• Hamba uye ekliniki noma esibhedlela leseduze NYALO — ungalindzi i-ambulensi\n\nSitawutama kuphendvula uma luhlelo selubuyile. Siyacolisa ngekuphazamisa.',
    ve: '⚠️ Ri khou ṱangana na thaidzo dza thekhinolodzhi nahone a ri koni u shumisa mulaedza waṋu zwino.\n\n🚨 *Arali i tshoganetso:*\n• Founelani *10177* (ambulense) kana *084 124* (ER24)\n• Iyani kiliniki kana sibadela tshi re tsini ZWINO — ni songo lindela ambulense\n\nRi ḓo lingedza u fhindula musi sisiteme i tshi vhuya. Ri humbela pfarelo.',
    nr: '⚠️ Sinekinga yebuchwepheshe futhi asikghoni ukusebenza umlayezo wakho nje.\n\n🚨 *Uma kuphuthumako:*\n• Ringela *10177* (i-ambulensi) namkha *084 124* (ER24)\n• Iya ekliniki namkha esibhedlela esiseduze NJE — ungalindeli i-ambulensi\n\nSizakuzama ukuphendula uma uhlelo selubuyile. Siyacolisa ngokuphazamisa.'
  },

  // ==================== DEVELOPMENT NOTICE (NON-WHITELISTED NUMBERS) ====================
  development_notice: {
    _all: `Thank you for contacting BIZUSIZO 🏥

This system is currently under development and is not yet available for public use.

🚨 *If you are experiencing a medical emergency:*
• Call *10177* (ambulance) or *084 124* (ER24)
• Go to your nearest clinic or hospital IMMEDIATELY

For more information, visit bizusizo.co.za

Siyabonga / Enkosi / Dankie / Re a leboga / Re a leboha`
  }

};

// ================================================================
// LANGUAGE HELPERS
// ================================================================
const LANG_MAP = { '1':'en','2':'zu','3':'xh','4':'af','5':'nso','6':'tn','7':'st','8':'ts','9':'ss','10':'ve','11':'nr' };

// ================================================================
// CATEGORY DESCRIPTIONS — maps menu numbers to clinical context
// ================================================================
// When a patient picks a category, this context is prepended to their
// symptom detail so the AI has meaningful information to triage.
const CATEGORY_DESCRIPTIONS = {
  '1': 'Breathing problems / Chest pain',
  '2': 'Head injury / Headache',
  '3': 'Pregnancy related complaint',
  '4': 'Bleeding / Wound',
  '5': 'Fever / Flu / Cough',
  '6': 'Stomach problems / Vomiting',
  '7': 'Child illness (paediatric)',
  '8': 'Medication / Chronic condition',
  '9': 'Bone / Joint / Back pain',
  '10': 'Mental health concern',
  '11': 'Allergy / Rash / Skin problem',
  '12': 'Other',
  '13': 'Speak to a human / send voice note',
  '14': "Women's health (family planning, Pap smear, breast screening, contraception)",
  '15': 'Health screening (HIV test, BP check, diabetes / glucose test)',
};

// ================================================================
// VOICE NOTE TRANSCRIPTION
// ================================================================
// WhatsApp voice notes arrive as audio messages with a media ID.
// We download the audio, send it to Claude for transcription,
// and use the transcribed text for triage.
// This is critical for SA context where many patients prefer
// speaking over typing, especially in African languages.
// ================================================================
async function downloadWhatsAppMedia(mediaId) {
  // Step 1: Get media URL from Meta
  const urlRes = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });
  const urlData = await urlRes.json();
  if (!urlData.url) return null;

  // Step 2: Download the actual audio file
  const audioRes = await fetch(urlData.url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });
  const buffer = await audioRes.buffer();
  return buffer;
}

async function transcribeVoiceNote(audioBuffer, lang) {
  const langNames = {
    en:'English', zu:'isiZulu', xh:'isiXhosa', af:'Afrikaans',
    nso:'Sepedi', tn:'Setswana', st:'Sesotho', ts:'Xitsonga',
    ss:'siSwati', ve:'Tshivenda', nr:'isiNdebele'
  };

  const base64Audio = audioBuffer.toString('base64');

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: `You are a medical transcription assistant for South Africa. Transcribe the patient's voice message accurately, preserving their exact words including any code-switching between languages. The patient likely speaks ${langNames[lang] || 'a South African language'}. Output ONLY the transcription — no commentary, no translation, no formatting. If you cannot understand the audio, respond with: TRANSCRIPTION_FAILED`,
      messages: [{
        role: 'user',
        content: [{
          type: 'document',
          source: { type: 'base64', media_type: 'audio/ogg', data: base64Audio }
        }, {
          type: 'text',
          text: 'Transcribe this voice message from a patient describing their health symptoms.'
        }]
      }]
    });

    const transcription = res.content[0].text.trim();
    if (transcription === 'TRANSCRIPTION_FAILED') return null;
    return transcription;
  } catch (e) {
    logger.error('[VOICE] Transcription failed:', e.message);
    return null;
  }
}


function msg(key, lang, ...args) {
  const msgSet = MESSAGES[key];
  if (!msgSet) return '';
  if (msgSet._all) return msgSet._all;
  const template = msgSet[lang || 'en'] || msgSet['en'];
  if (typeof template === 'function') return template(...args);
  return template;
}

module.exports = { MESSAGES, msg };

/**
 * Парсер размеров и соотношений сторон изображений на статьях блога.
 * Проходит по списку URL на трёх вьюпортах (десктоп/планшет/мобилка),
 * собирает natural- и rendered-размеры каждой картинки, считает aspect ratio,
 * сохраняет результат в CSV + JSON и печатает сводку по классам.
 *
 * Установка:
 *   npm install puppeteer
 *
 * Запуск:
 *   node images-parser.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

// === НАСТРОЙКИ — отредактируйте под себя ===

const urls = [
  'https://ddos-guard.ru/blog',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2024-Q4',
'https://ddos-guard.ru/blog/tendentsii-ddos-atak-2024',
'https://ddos-guard.ru/blog/kiberbezopasnost',
'https://ddos-guard.ru/blog/sistema-avtoplatezhei',
'https://ddos-guard.ru/blog/am-live-2025',
'https://ddos-guard.ru/blog/ransomware-virus',
'https://ddos-guard.ru/blog/vidy-rezervnogo-kopirovaniya',
'https://ddos-guard.ru/blog/itogi-2024-ddos-guard',
'https://ddos-guard.ru/blog/bekap-vds',
'https://ddos-guard.ru/blog/gruppi-pravil',
'https://ddos-guard.ru/blog/udp-protokol',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2025-Q1',
'https://ddos-guard.ru/blog/kvantovie-vichisleniya-i-kiberbezopasnost',
'https://ddos-guard.ru/blog/vidi-khostinga',
'https://ddos-guard.ru/blog/ddos-carpet-bombing',
'https://ddos-guard.ru/blog/servis-upravleniya-uyazvimostyami',
'https://ddos-guard.ru/blog/zhizn-ddos-guard-q1-q2-2025',
'https://ddos-guard.ru/blog/inventarizaciya-it-aktivov',
'https://ddos-guard.ru/blog/dostup-k-sajtam-v-rossii',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2025-Q2',
'https://ddos-guard.ru/blog/zakon-o-khostinge-prikaz-17',
'https://ddos-guard.ru/blog/cvss',
'https://ddos-guard.ru/blog/budushee-lets-encrypt-runet',
'https://ddos-guard.ru/blog/hackathon-ddos-guard-2025',
'https://ddos-guard.ru/blog/zashchita-seti',
'https://ddos-guard.ru/blog/hackathon-ddos-guard-2025-itogi',
'https://ddos-guard.ru/blog/setevaya-bezopasnost',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2025-Q3',
'https://ddos-guard.ru/blog/dns-hosting',
'https://ddos-guard.ru/blog/chto-takoe-model-osi',
'https://ddos-guard.ru/blog/ddos-guard-softline',
'https://ddos-guard.ru/blog/ddos-guard-obit-issledovanie',
'https://ddos-guard.ru/blog/sql-inektsiya',
'https://ddos-guard.ru/blog/amsterdam-3',
'https://ddos-guard.ru/blog/doverennii-istochnik-zaprosa',
'https://ddos-guard.ru/blog/ddos-guard-profit-security-day-2025',
'https://ddos-guard.ru/blog/ddos-guard-eurasia-peering',
'https://ddos-guard.ru/blog/zashita-sajta',
'https://ddos-guard.ru/blog/advent-kalendar-selectel',
'https://ddos-guard.ru/blog/itogi-2025-goda-v-ddos-guard',
'https://ddos-guard.ru/blog/chto-takoe-ataka-mitm',
'https://ddos-guard.ru/blog/partner-icl-services',
'https://ddos-guard.ru/blog/chto-takoe-2fa',
'https://ddos-guard.ru/blog/hakaton-ddos-guard-2026',
'https://ddos-guard.ru/blog/obnovlenie-razdelov-termini-i-tekhnologii',
'https://ddos-guard.ru/blog/kto-takie-ori',
'https://ddos-guard.ru/blog/tendentsii-ddos-atak-2025',
'https://ddos-guard.ru/blog/sotsialnaya-inzheneriya-v-kiberbezopasnosti',
'https://ddos-guard.ru/blog/sales-kit-ddos-guard',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2023-Q3',
'https://ddos-guard.ru/blog/mount-iso-na-vydelennyh-serverah',
'https://ddos-guard.ru/blog/obnovlenie-profilya-polzovatelya',
'https://ddos-guard.ru/blog/mezhdunarodnie-standarti-analiza-zashchishchennosti',
'https://ddos-guard.ru/blog/stoimost-zashchiti-ot-ddos-atak',
'https://ddos-guard.ru/blog/ii-v-kiberbezopasnosti',
'https://ddos-guard.ru/blog/ocsp-stapling-i-must-staple',
'https://ddos-guard.ru/blog/kibernoyabr-v-ddos-guard',
'https://ddos-guard.ru/blog/kakuyu-domennuyu-zonu-vybrat',
'https://ddos-guard.ru/blog/ddos-guard-na-linkmeetup-2023',
'https://ddos-guard.ru/blog/ddos-ataki-iot',
'https://ddos-guard.ru/blog/avtomatizatsiya-zakaza-serverov',
'https://ddos-guard.ru/blog/twin-tunnel-geo-block',
'https://ddos-guard.ru/blog/metodi-filtratsii-trafika',
'https://ddos-guard.ru/blog/ddos-guard-na-highload-2023-i-teamlead-conf',
'https://ddos-guard.ru/blog/obnovlenie-tarifov-hostinga',
'https://ddos-guard.ru/blog/novogodnie-skidki-v-ddos-guard-2023',
'https://ddos-guard.ru/blog/vidi-informatsionnoi-bezopasnosti',
'https://ddos-guard.ru/blog/itogi-2023-goda-v-ddos-guard',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2023-Q4',
'https://ddos-guard.ru/blog/tendentsii-ddos-atak-2023',
'https://ddos-guard.ru/blog/chto-takoe-pentest',
'https://ddos-guard.ru/blog/pochemu-pentest-nuzhen-biznesu',
'https://ddos-guard.ru/blog/izvestnie-khakeri',
'https://ddos-guard.ru/blog/tekhnicheskaya-podderzhka-v-it',
'https://ddos-guard.ru/blog/sozdateli-yazikov-programmirovaniya',
'https://ddos-guard.ru/blog/lokalnii-dostup-k-ipmi-kvm',
'https://ddos-guard.ru/blog/am-live-2024',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2024-Q1',
'https://ddos-guard.ru/blog/obnovlenie-dokumentatsii-api',
'https://ddos-guard.ru/blog/krupneishie-kiberataki-v-istorii',
'https://ddos-guard.ru/blog/obnovlenie-statistiki-l7',
'https://ddos-guard.ru/blog/zashchita-ot-ddos-atak-po-bgp',
'https://ddos-guard.ru/blog/obnovlenie-lk-partnerov',
'https://ddos-guard.ru/blog/skzi',
'https://ddos-guard.ru/blog/kak-zashchitit-server-minecraft-ot-ddos-atak',
'https://ddos-guard.ru/blog/sozdatel-interneta',
'https://ddos-guard.ru/blog/captcha',
'https://ddos-guard.ru/blog/kaptcha-ddos-ataki',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2024-Q2',
'https://ddos-guard.ru/blog/uyazvimost-openssh',
'https://ddos-guard.ru/blog/ddos-ataka',
'https://ddos-guard.ru/blog/obnovlenie-oblachnikh-servisov-i-modulei-l7',
'https://ddos-guard.ru/blog/testovii-period-basic',
'https://ddos-guard.ru/blog/virtualnii-khosting',
'https://ddos-guard.ru/blog/kiberataka',
'https://ddos-guard.ru/blog/hackathon-ddos-guard',
'https://ddos-guard.ru/blog/zashchita-ot-ddos-atak',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2024-Q3',
'https://ddos-guard.ru/blog/krupneyshiye-ddos-ataki-v-istorii',
'https://ddos-guard.ru/blog/kibernoyabr-2024',
'https://ddos-guard.ru/blog/dns-server',
'https://ddos-guard.ru/blog/botnet',
'https://ddos-guard.ru/blog/hackathon-ddos-guard-2024',
'https://ddos-guard.ru/blog/twin-tunnel-rate-limiter',
'https://ddos-guard.ru/blog/slowloris-ataka',
'https://ddos-guard.ru/blog/novogodnie-skidki-2024',
'https://ddos-guard.ru/blog/ddos-guard-v-podkaste-kverti',
'https://ddos-guard.ru/blog/kvm-console',
'https://ddos-guard.ru/blog/zashchita-ot-ddos-po-trebovaniyu',
'https://ddos-guard.ru/blog/ddos-guard-na-highload-2022',
'https://ddos-guard.ru/blog/blog-kompanii-ddos-guard-na-vc',
'https://ddos-guard.ru/blog/ddos-monitoring-kak-bystro-obnaruzhit-ddos-ataku-na-sajt',
'https://ddos-guard.ru/blog/zashita-i-uskorenie-sajta-s-novogodnej-skidkoj',
'https://ddos-guard.ru/blog/novyj-funkcional-uslugi-zashita-i-uskorenie-sajtov',
'https://ddos-guard.ru/blog/audit-kiberbezopasnosti',
'https://ddos-guard.ru/blog/vds-or-ds',
'https://ddos-guard.ru/blog/kak-zashitit-router-ot-ddos-atak',
'https://ddos-guard.ru/blog/kak-vibrat-auditora-kiberbezopasnosti',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2022',
'https://ddos-guard.ru/blog/obnovlenie-otchetov-ob-atakakh',
'https://ddos-guard.ru/blog/intervyu-s-seo-spetsialistom-ddos-guard',
'https://ddos-guard.ru/blog/itogi-goda-v-ddos-guard',
'https://ddos-guard.ru/blog/tendentsii-ddos-atak-2022',
'https://ddos-guard.ru/blog/obnovlenie-uslugi-vds-vps',
'https://ddos-guard.ru/blog/7-voprosov-o-zashchite-ot-ddos-atak',
'https://ddos-guard.ru/blog/8-voprosov-provaideru-zashchiti-ot-ddos-atak',
'https://ddos-guard.ru/blog/rukovodstvo-po-zashchite-ot-ddos',
'https://ddos-guard.ru/blog/obnovlenie-ssl-sertifikatov-i-nastroika-klyuchei-shifrovaniya',
'https://ddos-guard.ru/blog/moshchnost-ddos-atak',
'https://ddos-guard.ru/blog/segmentatsiya-domena',
'https://ddos-guard.ru/blog/novii-interfeis-razdela-statistika',
'https://ddos-guard.ru/blog/vydelennye-servery',
'https://ddos-guard.ru/blog/kak-zashchitit-server-ot-ddos',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2023-Q1',
'https://ddos-guard.ru/blog/kak-zashchitit-ip-ot-ddos',
'https://ddos-guard.ru/blog/obnovlenie-razdela-instruktsii',
'https://ddos-guard.ru/blog/kak-zashchitit-sait-ot-ddos',
'https://ddos-guard.ru/blog/blokirovka-zaprosov-iz-tor-setei',
'https://ddos-guard.ru/blog/novii-interfeis-videlennogo-servera',
'https://ddos-guard.ru/blog/kak-zashchitit-set-ot-ddos',
'https://ddos-guard.ru/blog/otcheti-ob-atakakh-l3-4-zashchita-saita',
'https://ddos-guard.ru/blog/ddos-guard-na-rinhhack',
'https://ddos-guard.ru/blog/bug-bounty-okhota-za-bagami',
'https://ddos-guard.ru/blog/prosmotr-anonsov-zashchita-seti',
'https://ddos-guard.ru/blog/ddos-guard-veloparad-2023',
'https://ddos-guard.ru/blog/zashchita-ot-ddos-nginx',
'https://ddos-guard.ru/blog/den-otkritikh-dverei-v-ddos-guard',
'https://ddos-guard.ru/blog/ux-pisatel-v-tekhnologicheskoi-kompanii',
'https://ddos-guard.ru/blog/virtualnii-khosting-ili-vds',
'https://ddos-guard.ru/blog/rukovodstvo-po-usluge-zashchiti-saita',
'https://ddos-guard.ru/blog/obnovlenie-processa-zakaza-vydelennogo-servera',
'https://ddos-guard.ru/blog/istoriya-i-primenenie-testa-tyuringa',
'https://ddos-guard.ru/blog/limit-zaprosov-l7-zashchity',
'https://ddos-guard.ru/blog/zashchita-ot-ddos-dlya-klienta-agrosignal',
'https://ddos-guard.ru/blog/ddos-v-igrovikh-servisakh',
'https://ddos-guard.ru/blog/daidzhest-kiberbezopasnosti-2023-Q2',
'https://ddos-guard.ru/blog/analiz-zashchishchennosti',
'https://ddos-guard.ru/blog/otklyuchenie-staryh-vds',
'https://ddos-guard.ru/blog/ddos-ataki-na-uchebnie-zavedeniya',
'https://ddos-guard.ru/blog/apparatnaya-zashchita-ot-ddos',
'https://ddos-guard.ru/blog/ddos-guard-na-night-telecom-forum-i-cros-2023',
'https://ddos-guard.ru/blog/ddos-guard-kod-ib',
'https://ddos-guard.ru/blog/analiz-zashchishchennosti-veb-prilozhenii',
'https://ddos-guard.ru/blog/konfigurator-parametrov-zashchiti-seti',
'https://ddos-guard.ru/blog/twin-tunnel-firewall',
'https://ddos-guard.ru/blog/analiz-zashchishchennosti-seti',
'https://ddos-guard.ru/blog/data-centr-iz-gonkonga-podvergsya-atake-mezhdunarodnogo-botneta',
'https://ddos-guard.ru/blog/skrytaya-ugroza-pulse-wave-ddos-atak',
'https://ddos-guard.ru/blog/5-zabluzhdenij-predprinimatelej-pro-bezopasnost-v-internete',
'https://ddos-guard.ru/blog/klientam-ddos-guard-dostupna-balansirovka-zaprosov',
'https://ddos-guard.ru/blog/ddos-guard-priglashaet-na-vserossijskij-tehnicheskij-forum-breakpoint-2019',
'https://ddos-guard.ru/blog/v-sankt-peterburge-zapushen-novyj-uzel-filtracii-trafika-ddos-guard',
'https://ddos-guard.ru/blog/avtomatizaciya-v-detektirovanii-ddos-atak-pochemu-bez-nee-vasha-zashita-bessilna',
'https://ddos-guard.ru/blog/nebolshie-ddos-ataki-pochemu-ih-nelzya-ignorirovat',
'https://ddos-guard.ru/blog/osobennosti-zashity-lokalnyh-serverov-ot-ddos-atak',
'https://ddos-guard.ru/blog/kak-biznesu-snizit-riski-dlya-bezopasnosti-dannyh',
'https://ddos-guard.ru/blog/algoritmy-brotli-recompressiya-i-HSTS-chto-novogo-predlagaet-DDoS-GUARD',
'https://ddos-guard.ru/blog/po-bystromu-kak-tehnologii-keshirovaniya-uskoryayut-zagruzku-vashego-sajta',
'https://ddos-guard.ru/blog/ddos-guard-na-selectel-meetup',
'https://ddos-guard.ru/blog/pandemiya-i-trafik-update-veb-trafik-prodolzhaet-rasti',
'https://ddos-guard.ru/blog/rasprostranennye-kiberugrozy-i-kak-s-nimi-borotsya',
'https://ddos-guard.ru/blog/interview-ddos-guard-dlya-am-live',
'https://ddos-guard.ru/blog/novye-vozmozhnosti-nashego-hostinga',
'https://ddos-guard.ru/blog/otchet-o-ddos-atakah-2018-2020',
'https://ddos-guard.ru/blog/rasshirenie-i-optimizaciya-svyaznosti-setej-ddos-guard',
'https://ddos-guard.ru/blog/u-nas-poyavilsya-plesk-obsidian',
'https://ddos-guard.ru/blog/prisoedinenie-seti-ddos-guard-k-ams-ix',
'https://ddos-guard.ru/blog/esli-vam-ugrozhayut-ddos-atakoj',
'https://ddos-guard.ru/blog/cdn-servis-uskoreniya-zagruzki-sajta',
'https://ddos-guard.ru/blog/twintunnel',
'https://ddos-guard.ru/blog/witchhunter',
'https://ddos-guard.ru/blog/global-proxy',
'https://ddos-guard.ru/blog/hourly-monthly-billing',
'https://ddos-guard.ru/blog/cpanel-update',
'https://ddos-guard.ru/blog/ddg-connecting-country',
'https://ddos-guard.ru/blog/ddos-attack-trends-for-2022-q1',
'https://ddos-guard.ru/blog/geoblokirovka-pri-zashite-na-urovne-l7',
'https://ddos-guard.ru/blog/chem-opasny-ddos-ataki',
'https://ddos-guard.ru/blog/kak-zashitit-igrovoj-server-ot-ddos-atak',
'https://ddos-guard.ru/blog/sposoby-zashity-ot-ddos-atak',
'https://ddos-guard.ru/blog/obnovlenie-konfiguratora-zashishennyh-vds-v-ddos-guard',
'https://ddos-guard.ru/blog/kak-pravilno-vybrat-hosting-s-zashitoj-ot-ddos-atak',
'https://ddos-guard.ru/blog/martyshka-shmidta-pod-opekoj-ddos-guard',
'https://ddos-guard.ru/blog/obnovlenie-otchetov-ob-atakah-dlya-servisa-zashita-seti',
'https://ddos-guard.ru/blog/chto-delat-pri-ddos-atake',
'https://ddos-guard.ru/blog/chem-opasen-dauntaim',
'https://ddos-guard.ru/blog/novyj-tarif-medium',
'https://ddos-guard.ru/blog/testirovanie-zashchity-ot-ddos',
'https://ddos-guard.ru/blog/kak-otklyuchit-zashitu-ot-ddos-atak',
'https://ddos-guard.ru/blog/7-uyazvimostej-na-sajte',
'https://ddos-guard.ru/blog/ddos-guard-rejting-rabotodatelej-hh-ru',
'https://ddos-guard.ru/blog/otchet-s-mitapa-rndtech',
'https://ddos-guard.ru/blog/chto-takoe-faervol',
'https://ddos-guard.ru/blog/plan-reagirovaniya-na-incidenty-kiberbezopasnosti',
'https://ddos-guard.ru/blog/osobennosti-raboty-marketologa-s-b2b-v-sfere-it',
'https://ddos-guard.ru/blog/11-11-kak-podgotovit-sajt-ko-vsemirnomu-dnyu-shopinga',
'https://ddos-guard.ru/blog/glavnye-oshibki-v-organizacii-ddos-zashity',
'https://ddos-guard.ru/blog/ddos-guard-na-gitex-global-2022',
'https://ddos-guard.ru/blog/ddos-protection-myths',
'https://ddos-guard.ru/blog/DDoS_GUARD_na_Vserossiiskoi_konferencii_informacionnoi_bezopasnosti',
'https://ddos-guard.ru/blog/cherv-mirai-vse-eshe-v-dele-ddos-ataki-na-onlajn-magazin-prevysili-85-mpps',
'https://ddos-guard.ru/blog/solution-for-Internet-security-business',
'https://ddos-guard.ru/blog/the-size-of-ddos-attacks-increased-183-times-the-iot-vulnerabilities-create-new-realities',
'https://ddos-guard.ru/blog/servisy-ddos-guard-predstavili-na-vystavke-v-tokio',
'https://ddos-guard.ru/blog/nejrointerfejs-velokarty-i-drugie-proekty-na-rnd-startup-day',
'https://ddos-guard.ru/blog/hakaton-uspet-za-47-chasov',
'https://ddos-guard.ru/blog/pri-podderzhke-ddos-guard-sostoyalsya-mezhdunarodnyj-grand-forum-bit-17',
'https://ddos-guard.ru/blog/v-rostove-sostoyalsya-pervyj-devfest-pri-podderzhke-ddos-guard',
'https://ddos-guard.ru/blog/turnir-professional-2017-sobral-luchshih-studentov-inzhenerov-yufu',
'https://ddos-guard.ru/blog/na-mobile-world-congress-predstavili-novinki-i-obsudili-problemy-mobilnoj-bezopasnosti',
'https://ddos-guard.ru/blog/massirovannaya-ataka-dlilas-troe-sutok',
'https://ddos-guard.ru/blog/v-rostove-na-donu-sostoyalsya-final-turnira-professional-2017',
'https://ddos-guard.ru/blog/na-cebit-2017-v-gannovere-predstavili-model-cifrovogo-pravitelstva',
'https://ddos-guard.ru/blog/kod-bezopasnosti-novye-kiberugrozy-obsudili-na-yuge-rossii',
'https://ddos-guard.ru/blog/ddos-guard-prinyal-uchastie-v-yarmarke-vakansij-yufu',
'https://ddos-guard.ru/blog/ddos-guard-podderzhit-konferenciyu-evroaziatskoj-gruppy-setevyh-operatorov',
'https://ddos-guard.ru/blog/vyhodnye-pod-znakom-kodinga-troe-sutok-chtoby-sovershit-karernyj-proryv',
'https://ddos-guard.ru/blog/yupiter-2017-kurs-na-integraciyu-i-operezhayushee-razvitie',
'https://ddos-guard.ru/blog/v-sankt-peterburge-zavershila-rabotu-regionalnaya-konferenciya-enog-13',
'https://ddos-guard.ru/blog/rossiya-voshla-v-trojku-liderov-po-chislu-zhertv-ddos-atak',
'https://ddos-guard.ru/blog/ukrainskij-hosting-provajder-podvergsya-ddos-atake-iz-kitaya',
'https://ddos-guard.ru/blog/kak-predotvratit-ddos-ataku',
'https://ddos-guard.ru/blog/servis-ddos-guard-vnesen-v-reestr-otechestvennogo-po',
'https://ddos-guard.ru/blog/perenapravlenie-trafika-na-filtraciyu-s-primeneniem-bgp-flowspec',
'https://ddos-guard.ru/blog/zashita-ot-ddos-atak-posredstvom-geofiltracii-trafika-na-marshrutizatorah-juniper-s-primeneniem-source-class-usage',
'https://ddos-guard.ru/blog/servisy-zashity-ot-ddos-guard-licenzirovany-fstek-rossii',
'https://ddos-guard.ru/blog/srednyaya-moshnost-ddos-atak-vyrosla-v-9-5-raza',
'https://ddos-guard.ru/blog/hosting-provajder-iz-kitaya-podvergsya-16-ddos-atakam-za-sutki',
'https://ddos-guard.ru/blog/ddos-ataki-segodnya-ugroza-dlya-vseh',
'https://ddos-guard.ru/blog/classification-of-ddos-attacks',
'https://ddos-guard.ru/blog/rabota-v-it-ot-sajtostroeniya-do-borby-s-ddos-atakami',
'https://ddos-guard.ru/blog/ddos-ataka-segodnya-novye-tipy-kiberugroz',
'https://ddos-guard.ru/blog/enog14-v-minske-uyazvimosti-iot-ipv4-prefix-hijacking-i-blokirovki-kontenta-v-internet',
'https://ddos-guard.ru/blog/ispsystem-i-ddos-guard-sdelali-nadezhnuyu-zashitu-ot-ddos-atak-dostupnoj-kazhdomu-zashitu-mozhno-budet-vklyuchit-paroj-klikov',
'https://ddos-guard.ru/blog/dos-i-ddos-ataki',
'https://ddos-guard.ru/blog/na-novyj-god-ddos-atak-stanet-bolshe',
'https://ddos-guard.ru/blog/ttk-usilil-zashitu-korporativnyh-klientov-ot-ddos-atak',
'https://ddos-guard.ru/blog/hakaton-dgtu-veselye-rybki-slozhnye-algoritmy-bolshie-perspektivy',
'https://ddos-guard.ru/blog/novaya-mirovaya-ddos-ugroza-obrushilas-na-klientov-ddos-guard',
'https://ddos-guard.ru/blog/zashishennye-ot-ddos-vydelennye-servery-chto-eto-za-usluga',
'https://ddos-guard.ru/blog/ddos-guard-zapustil-novyj-uzel-filtracii-v-azii',
'https://ddos-guard.ru/blog/zashita-ot-ddos-atak-besplatno-chto-mozhet-predlozhit-rynok',
'https://ddos-guard.ru/blog/georaspredelennyj-dns-hosting-s-zashitoj-ddos-guard-besplatno',
'https://ddos-guard.ru/blog/ddos-guard-predostavlyaet-besplatnyj-ssl-sertifikat-na-vseh-tarifah',
'https://ddos-guard.ru/blog/ddos-ataki-cherez-memcached-servery-ddos-guard-nashel-reshenie',
'https://ddos-guard.ru/blog/neobhodimo-li-filtrovat-full-view-ot-aplinkov',
'https://ddos-guard.ru/blog/ddos-guard-priglashaet-na-cloud-expo-asia',
'https://ddos-guard.ru/blog/resheniya-ddos-guard-ocenili-na-vystavke-v-gonkonge',
'https://ddos-guard.ru/blog/yandeks-i-google-stali-eshe-blizhe-dlya-klientov-ddos-guard',
'https://ddos-guard.ru/blog/ddos-guard-priglashaet-na-selecteltechday',
'https://ddos-guard.ru/blog/provajder-iz-kitaya-podvergsya-ddos-atake-moshnostyu-bolee-380-gbps',
'https://ddos-guard.ru/blog/ddos-guard-anonsiruet-pervuyu-tochku-filtracii-trafika-v-sankt-peterburge',
'https://ddos-guard.ru/blog/ddos-guard-rasshiryaet-prisutstvie-v-azii'
];

const viewports = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

// сколько ждать (мс) после скролла — чтобы lazy-loaded картинки успели подгрузиться
const LAZY_LOAD_WAIT = 1200;

// =============================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
}

function ratio(w, h) {
  if (!w || !h) return '';
  return (w / h).toFixed(3);
}

(async () => {
  const browser = await puppeteer.launch();
  const results = [];

  for (const url of urls) {
    for (const vp of viewports) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height });

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // прокручиваем страницу целиком, чтобы триггернуть lazy-loading картинок
        await autoScroll(page);
        await delay(LAZY_LOAD_WAIT);
        // возвращаемся наверх (не обязательно, но чище для скриншотов при отладке)
        await page.evaluate(() => window.scrollTo(0, 0));

        const images = await page.evaluate(() => {
          return [...document.querySelectorAll('img')].map((img) => {
            const rect = img.getBoundingClientRect();
            return {
              src: img.currentSrc || img.src,
              className: img.className || '',
              alt: img.alt || '',
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              renderedWidth: Math.round(rect.width),
              renderedHeight: Math.round(rect.height),
            };
          });
        });

        images.forEach((img) => {
          results.push({
            url,
            viewport: vp.name,
            class: img.className,
            alt: img.alt,
            src: img.src,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            naturalRatio: ratio(img.naturalWidth, img.naturalHeight),
            renderedWidth: img.renderedWidth,
            renderedHeight: img.renderedHeight,
            renderedRatio: ratio(img.renderedWidth, img.renderedHeight),
          });
        });

        console.log(`✓ ${url} [${vp.name}] — найдено ${images.length} изображений`);
      } catch (err) {
        console.error(`✗ Ошибка на ${url} [${vp.name}]: ${err.message}`);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();

  // === Сохраняем CSV ===
  const headers = [
    'url', 'viewport', 'class', 'alt', 'src',
    'naturalWidth', 'naturalHeight', 'naturalRatio',
    'renderedWidth', 'renderedHeight', 'renderedRatio',
  ];
  const csvRows = [headers.join(',')];
  results.forEach((r) => {
    csvRows.push(
      headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
    );
  });
  fs.writeFileSync('images-report.csv', csvRows.join('\n'), 'utf8');
  fs.writeFileSync('images-report.json', JSON.stringify(results, null, 2), 'utf8');

  console.log(`\nГотово! Сохранено ${results.length} записей в images-report.csv и images-report.json`);

  // === Сводка по классам и вьюпортам — помогает быстро увидеть "устойчивые" пропорции ===
  const groups = {};
  results.forEach((r) => {
    if (!r.renderedRatio) return;
    const key = `${r.class || '(без класса)'} — ${r.viewport}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(parseFloat(r.renderedRatio));
  });

  console.log('\n=== Сводка по классам и вьюпортам (rendered aspect ratio) ===');
  Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, ratios]) => {
      const avg = (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(3);
      const min = Math.min(...ratios).toFixed(3);
      const max = Math.max(...ratios).toFixed(3);
      const consistent = min === max ? '✓ одинаковое' : `разброс ${min}–${max}`;
      console.log(`${key}: n=${ratios.length}, avg=${avg}, ${consistent}`);
    });
})();

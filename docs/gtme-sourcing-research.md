# GTME sourcing research - specialist VC boards and pro services (2 Sep 2026)

Raw findings behind the sourcing discussion on 2 Sep. Three parallel research passes, lightly edited. Verified where stated; anything marked unverified was not fetched directly. Reference material for the VC Job Sweeper v2 board list and for a future ATS-polling provider.

## 1. Minor / specialist VC portfolio boards

Getro = "Powered by Getro" plus `/companies/<co>/jobs/<id>-<slug>` links (a Sources row on the existing `/getro` endpoint). Consider = React shell with `/api-boards` (a Sources row on `/consider`).

| Fund | Board URL | Platform | Approx jobs | UK/London | Note |
|---|---|---|---|---|---|
| Point Nine | jobs.pointnine.com/jobs | Getro | 1,767 | Medium (incident.io, Attio, Revolut) | Best European B2B SaaS seed fund; GTM Engineer at incident.io live |
| Moonfire | positions.moonfire.com/jobs | Getro | 262 | High (Humaans, Flagright, Mindstone) | London AI-native seed; GTM Engineer at Humaans live |
| Firstminute | jobs.firstminute.capital/jobs | Getro | 510 | High (Wayve, n8n, Mistral EMEA) | 40 hits on "GTM" |
| Cherry Ventures | talent.cherry.vc/jobs | Getro | 57 on GTM query | Medium (Manual, Cortea) | Founding GTM Engineer, Head of GTM, RevOps Manager live |
| Outlier Ventures | jobs.outlierventures.io/jobs | Getro | 39 | High (Zinc x8) | GTM Operations Lead + Commercial Ops Lead at Zinc live |
| Backed VC | talent.backed.vc/jobs | Getro | 264 | High (Thought Machine, CloudNC, Phytoform) | London seed |
| Speedinvest | careers.speedinvest.com/jobs | Getro | 1,371 | Medium (Adverity, Flowdesk, Primer) | 149 hits on GTM query |
| SuperSeed | careers.superseed.com/jobs | Getro | 12 | High | Tiny B2B AI seed board, 4 of 12 London |
| Techstars | jobs.techstars.com/jobs | Getro | 4,830 | Medium | GTM Engineer at Cledara (London, Series A) live |
| Antler | careers.antler.co/jobs | Getro | 1,096 | Low-medium | Mostly founder roles |
| byFounders | jobs.byfounders.vc/jobs | Getro | 69 | Low (Nordic) | 3 GTM Engineer titles live |
| Stage 2 Capital | careers.stage2.capital/jobs | Getro | 220 | Low, US-heavy | The GTM-specialist fund |
| Craft Ventures | jobs.craftventures.com/jobs | Getro | 1,749 | Medium (Vanta, Candex) | Director of GTM, GTM Enablement live |
| General Catalyst | jobs.generalcatalyst.com/jobs | Getro | 19,216 | Medium | Volume board |
| Insight Partners | jobs.insightpartners.com/jobs | Getro | 10,931 | Medium | Volume board |
| Redpoint | careers.redpoint.com/jobs | Getro | 3,340 | Medium | Sales-heavy |
| Khosla | jobs.khoslaventures.com/jobs | Getro | 11,698 | Low | Volume, little UK |
| GTMfund | jobs.gtmfund.com/jobs | Consider | 678 (149 cos) | Unverified | GTM operator-LP fund; sales-tech portfolio |
| Playfair Capital | careers.playfair.vc/jobs | Consider | Unverified | High | London pre-seed |
| Bessemer | jobs.bvp.com/jobs | Consider | Unverified | Medium | Has location filter |
| Lightspeed | jobs.lsvp.com/jobs | Consider | 14,957 | Unverified | Very high volume |
| Felicis | jobs.felicis.com/jobs | Consider | Unverified | Unverified | AI-heavy |
| Greylock | greylock.com/jobs/portfolio-jobs/ | Other (custom) | 1,984 | Low-medium | Own scraper needed |
| Coatue | jobs.coatue.com/jobs | Unverified | 11,610 | Low | Likely Getro-style, unconfirmed |
| First Round | jobs.firstround.com | Consider, login-gated | n/a | n/a | Not scrapeable |
| Founders Factory | foundersfactory.com/startup-jobs/ | Other (Gatsby) | 0 rendered | n/a | |
| YC Work at a Startup | workatastartup.com/jobs | Other | 406 on fetch | Unverified | Needs browser |

No public portfolio job board found: Air Street, Unusual Ventures, Bloomberg Beta, Concept Ventures, Ada Ventures (talent-network signup only), Episode 1, Frontline (own roles only), Passion Capital, Fuel Ventures, Stride, Fly, Cavalry, Ascension, Haatch, Form, 20VC, Benchmark. 7percent: unverified.

Live GTM-type roles spotted 2 Sep: GTM Engineer at incident.io (London, Point Nine), Humaans (London, Moonfire), Cledara (London, Techstars); GTM Operations Lead and Commercial Operations Lead at Zinc (London, Outlier); Founding GTM Engineer at Plato (Berlin, Cherry); GTM Engineer at Corti, Monta (byFounders).

## 2. Professional services

| Firm | What | HQ | Careers / ATS | Hiring signal now |
|---|---|---|---|---|
| Clay (vendor) | GTM data platform | NYC, London office | Ashby `claylabs` (public JSON) | 60 open; London: AE (GTME - Strategic), Sales Manager (GTME), Growth Strategist Enterprise CS, Partner Manager. "GTM Engineer" titled roles NYC-only |
| Apollo (vendor) | Sales data / sequencing | SF, London | Greenhouse `apolloio` | Solutions Consultant II Presales EMEA London 20 Aug; Sr GTM Enablement Mgr London |
| HubSpot (vendor) | CRM | Dublin/London | Greenhouse `hubspotjobs` | Senior Solutions Engineer Nordilux, Remote UK 27 Aug |
| Cognism (vendor) | B2B data | London | Greenhouse `cognism` | Sr Manager, Solutions Consulting London 26 Aug |
| n8n (vendor) | Automation | Berlin, London office | Ashby `n8n` | Head of Solutions Engineering (Berlin/UK/remote EU) 28 Jul |
| ZoomInfo | B2B data | US | Greenhouse `zoominfo` | Senior Forward Deployed Engineer, Remote (US, unverified for UK) |
| Gong, Salesloft, Make, Unify, Artisan, Relevance AI | GTM tooling | US/Prague/AU | Greenhouse / Ashby | No EMEA GTME/FDE roles; Artisan "Forward Deployed GTM Architect" and Unify "GTM Engineering Intern" SF-only |
| The Kiln | Clay Elite Studio, ex-Clay staff | US (unverified) | No careers page; LinkedIn | Runs a "GTM Engineer hiring program" for clients |
| Go Nimbly | RevOps / Clay Elite Studio | US | Ashby `go-nimbly` | Senior RevOps Consultant (Clay) 28 Aug, US states only; RevOps Engineer LATAM |
| RevPartners | Elite Clay + Elite HubSpot | Atlanta | revpartners.io/careers (Teamtailor widget) | "Hire globally"; listings not readable server-side |
| GTM Studios | Clay partner | UK / Dubai | Site unreachable; LinkedIn (unverified) | None seen |
| mgsh. | Clay partner | UK / EMEA | Site blocks bots; LinkedIn (unverified) | None seen |
| Engineered GTM | Founder-led Clay+HubSpot | London | No careers page | None |
| ColdIQ | Clay outbound agency | Belgium / Barcelona | careers 404; prior GTM Engineer post dead | None live |
| Scalantec | DACH GTME agency | Germany | LinkedIn | Stale |
| Workflows.io | Clay partner, GTM-as-a-service | Unverified | getstarted.workflows.io/careers (Notion) | GTM Engineer listed (not readable) |
| Punch! | B2B sales-dev agency, remote-first, 90+ staff | UK-registered | punchb2b.com/careers (custom) | Lead GTM Engineer (remote contractor; Clay/n8n/Claude Code) posted in Clay community 21 Aug via Google Form |
| Let's Fearlessly Grow | London outbound agency | London | LinkedIn | GTM Account Director, London hybrid, to 44k, 21 Aug |
| noticed. | UK LinkedIn agency | UK/remote | Slack/email | GTM Engineer 30-33k remote, May 2026, closed |
| Huble | HubSpot Elite | London | huble.com/careers/uk (HubSpot CMS, no ATS) | None rendered |
| Six & Flow | HubSpot Elite | Manchester/London | sixandflow.com/join-the-team | None rendered |
| BabelQuest | HubSpot Elite | UK | babelquest.co.uk/careers (on-site form) | HubSpot Consultant, UK, ASAP |
| Digital Litmus | HubSpot partner, 4-day week | UK | Contact form | RevOps Manager 45k+, immediate |
| Avidly | HubSpot Elite | Nordics/UK | Personio | None open |
| Herd Digital (recruiter) | Recruits for unnamed consultancy | London | herd.digital/job/consulting-gtm-engineer | Consulting GTM Engineer, London hybrid, 100-150k (date unknown) |
| Accenture Song, Deloitte Digital, Slalom, Merkle, Jellyfish, Brainlabs, Dept, Croud | Large agencies | UK | Own ATS | No "GTM engineer" titled roles surfaced (unverified) |

Read: UK and EU GTME agencies are almost all founder-led shops of 1-10 people with no careers page and no ATS; hires surface as LinkedIn posts, Clay community posts, or DMs. Vendor-side pro services in London are real but titled Solutions Consultant / Solutions Engineer / Growth Strategist, on Greenhouse or Ashby with public JSON. UK HubSpot Elite partners hire "HubSpot Consultant / RevOps Manager" on custom pages, at 45k-ish.

## 3. Niche boards, communities and aggregators

| Source | URL | Public | Search/filter | Alerts / RSS / API | UK GTME hits now | Notes |
|---|---|---|---|---|---|---|
| Clay community Share Jobs | community.clay.com/x/share-jobs | Yes | No | RSS: /x/share-jobs/rss.xml (near-daily); /x/part-time-jobs/rss.xml | Agency-side, mostly remote contractor / US-LATAM | Most machine-consumable agency source |
| Cargo GTM jobs | getcargo.ai/jobs | Yes | Remote/hybrid/onsite, seniority | None; plain HTML, scrapeable | 974 global; UK: HowNow, Ably, LILT | Links out to ATS/LinkedIn |
| RevOps Roles | revopsroles.com/categories/gtm-engineering | Yes | Country, mode, seniority, tools | Email at /alerts; bot checkpoint 429s scrapers | 397 global; 0 UK visible | Best filters |
| gtme.jobs | gtme.jobs | Yes | Country incl UK, remote, salary | Weekly email | JS-rendered | Claims 175k career sites + LinkedIn |
| Bloomberry GTM board | bloomberry.com/gtm_jobs.html | Yes | Location, level, size | Paid API | 371 global; EU few | Crawls career sites |
| GTMEcareers | gtmecareers.com | Yes | Country (UK/DE), remote | None | 141 GTME category | |
| gtmjobs.xyz | gtmjobs.xyz | Yes | Location, stack, salary | Monday email | 0 UK | |
| RevOps Careers | revopscareers.com | Yes | Country, remote, tools | Email + RSS | GTME sparse | Carried Uncapped/LILT before |
| GTMfund board | jobs.gtmfund.com/jobs | Yes (Consider) | Role, location, stage | Talent-network email | Mostly US | |
| RevGenius | jobs.revgenius.com (402); community forum indexed | Partly | No | Membership | Mostly US remote | |
| RevOps Co-op, WizOps, Modern Sales Pros, Pavilion | Slack / login | No | n/a | n/a | Unverified | |
| Welcome to the Jungle (Otta) | app.welcometothejungle.com | Login for search; job pages public | Title, location | Email alerts (already a sender) | Attest, Granola, Count, Maze | Highest density of London GTME ads seen |
| Wellfound | wellfound.com | Yes | Role, location | Email | Humaans, Uncapped (stale) | Lagging duplicates |
| Built In London | builtinlondon.uk | Yes | Title, location | Email (already a sender) | Perk (removed) | |
| Glassdoor UK | glassdoor.co.uk | Yes | Title, location | Email | 7 of first 15 literal hits | Ably, HowNow, Monta, LILT, Ben, DeepL |
| Indeed UK | uk.indeed.com | Yes | Title, location | Email, no API | 4 of ~16 | |
| nRev, GTME Pulse, gtm-engineer-jobs.com, GTME HQ | various | Yes | Minimal | None | 0 UK | Skip |

## 4. Title variants seen in live UK/EU ads

Dominant: GTM Engineer / Senior / Founding GTM Engineer (Ben, HowNow, Ably, Attest, Perk, Granola, Count, Maze). Occasional: Go-to-Market (GTM) Engineer (Monta); GTM Systems Engineer / Lead (Nivoda); GTM Engineer (RevOps / SalesOps) or (Revenue Systems & Automation) (Fuelius, WorkMotion). Rare: RevOps Engineer (Factorial, closed); GTM Engineer, Outbound (Shippeo, closed); Marketing Operations Manager / GTM Engineer (DeepL). Not observed in UK/EU: Outbound Engineer, Revenue Engineer, Demand Gen Engineer, Sales Systems Engineer.

## 5. ATS and aggregator APIs

| Platform | Endpoint | Cross-company search | Notes |
|---|---|---|---|
| Ashby | api.ashbyhq.com/posting-api/job-board/{slug} | No, per slug | Most common ATS in this sweep (Ben, Duvo, Nivoda, Clay, n8n) |
| Greenhouse | boards-api.greenhouse.io/v1/boards/{slug}/jobs | No, per slug | EU boards on job-boards.eu.greenhouse.io (Ably = ably30) |
| Lever | api.lever.co/v0/postings/{slug}?mode=json | No | Verified |
| Workable | apply.workable.com/api/v1/widget/accounts/{slug}?details=true; jobs.workable.com search | Search yes; scraping blocked by robots | Uncapped, Fuelius use it |
| Teamtailor | {careers-site}/jobs.rss | No, per site RSS | Verified (Monta, HowNow) |
| Adzuna | developer.adzuna.com (free key) | Yes, UK keyword + location | Not re-verified today |
| Reed, Jooble | reed.co.uk/developers; jooble.org/api | Yes | Unverified |

## 6. Live in-house roles of the Uncapped shape (2 Sep 2026)

- GTM Engineer, Ben (employee benefits, London hybrid), Ashby, 10 Jul: jobs.ashbyhq.com/Ben/20619c15-de52-455a-98c5-2c061adbc345
- GTM Engineer - Hybrid (UK), HowNow (London), Teamtailor, 24 Aug: careers.gethownow.com/jobs/8258068-gtm-engineer-hybrid-uk
- Go-to-Market (GTM) Engineer, Monta (EV charging, London hybrid), Teamtailor, 28 Jul: careers.monta.com/jobs/8138646-go-to-market-gtm-engineer
- GTM Systems Engineer, Nivoda (London/Amsterdam/Boston), Ashby (unverified): jobs.ashbyhq.com/nivoda/a7336d59-9340-472a-88fc-e27e71625ff9
- GTM Engineer, Attest (London), WTTJ (unverified)
- GTM Engineer, Ably (London) and LILT (London hybrid), via Cargo (unverified on ATS)
- Lead AI GTM Engineer, Hostaway (remote Europe, Recruitee): careers.hostaway.com/o/lead-gtm-engineer-remote-europe
- Consulting GTM Engineer via Herd Digital, London, 100-150k: herd.digital/job/consulting-gtm-engineer
- Lead GTM Engineer, Punch! (remote contractor; Clay/n8n/Claude Code): community.clay.com/x/share-jobs/msg_smt1yxVfZCBi
- Recently closed, same pattern: Perk, Granola (100-130k), Count (90-95k remote UK/EU), Maze (60-80k), Preply, Uncapped

## 7. Coverage measurement (2 Sep 2026)

Method: took every GTM-family UK/remote role in the Roles Inventory first seen in the last 90 days that arrived via a non-VC-board channel (LinkedIn alerts, Built In, Jack and Jill, JYMBII, WTTJ etc.) - 306 rows, 254 distinct employers - and checked whether the employer had any GTM-family listing on the 17 scraped boards over the same 90 days (Worker called with `days=90&loc=all`; 508 distinct companies across the boards).

Result: 43 of 254 employers (17%), 56 of 306 rows (18%) were on a scraped board. Getro's 20-cards-per-term cap truncates older listings, and a couple of alias misses (Ably Realtime / Owner.com), so the true figure is nearer 20-25%.

Gap decomposition of the 211 employers not on a board: roughly 30 recruiters/agencies and 55 large corporates or US public companies (no VC board will ever carry them), roughly 25 bootstrapped / sub-seed / unverifiable, leaving roughly 65 funded UK/EU startups - the addressable gap. Of employers that are funded startups, coverage today is about 40% (43 of ~108).

Investor tally across the ~65 addressable misses (2+ mentions): Y Combinator 6; Index 5 (scraped); General Catalyst, a16z, Partech 3 each; Point72, Lightspeed, Creandum, Cherry, HV Capital, Headline, Crane, Moonfire, ICONIQ, 20VC, Visionaries Club, Next47, Spark, Schroders Capital, NFDG, Hg, 10x Founders 2 each. Boards exist for: General Catalyst (Getro), Partech (Getro, portfoliojobs.partechpartners.com), Lightspeed (Consider), Creandum (Consider, careers.creandum.com), Cherry (Getro), HV Capital (Getro, jobs.hvcapital.com), Headline (Getro, jobs.headline.com), Crane (Getro, careers.crane.vc), Moonfire (Getro), Point72 (Consider-hosted), a16z (custom, 19k jobs), YC (workatastartup.com, own platform). No board: ICONIQ, 20VC, Visionaries Club, Next47, Schroders, NFDG, Hg, 10x Founders, Eight Roads (own roles only), Frontline, Lakestar, Kinnevik.

Read: no single fund closes the gap - the long tail dominates. Adding the nine Getro/Consider boards above recovers perhaps 20 of the 65 addressable employers. A second chunk (Nscale, ClearScore, Unity, CUBE, Trackunit, Hostaway, Attest, Prevalent) is growth/PE-backed with no investor boards, and a quarter is bootstrapped; both only surface via LinkedIn or per-company ATS polling. Note also that a VC's board is an opt-in subset of its portfolio (Perk is Atomico/LocalGlobe-backed and still missed), so board coverage of a portfolio is itself partial.

/* playbook.js — tactical formations + 30 animation "systems" per sport.
   Each system, when picked, builds a short multi-frame animation from the
   current objects so the play animates on the tactical board. */
const PLAYBOOK = (() => {
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Deterministic PRNG so every system animates the same way each time.
  function rng(seed) { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  // 18 generic tactical systems shared by every sport (appended after specifics).
  const SHARED = [
    ['Give & Go', 'Aflever & løb'], ['Overlap Run', 'Overlaps-løb'], ['Screen & Roll', 'Skærm & rul'],
    ['Fast Break', 'Hurtigt kontra'], ['Counter Press', 'Modpres'], ['Overload Left', 'Overtal venstre'],
    ['Overload Right', 'Overtal højre'], ['Switch of Play', 'Sideskift'], ['High Press', 'Højt pres'],
    ['Low Block', 'Lavt blok'], ['Set Play A', 'Fast spil A'], ['Set Play B', 'Fast spil B'],
    ['Isolation', 'Isolation'], ['Decoy Run', 'Lokkeløb'], ['Quick Restart', 'Hurtig genstart'],
    ['Numbers Up', 'Overtalsspil'], ['Tempo Change', 'Temposkift'], ['Full Sequence', 'Fuld sekvens']
  ];

  // 12 sport-specific systems each (combined with SHARED = 30 per sport).
  const SPECIFIC = {
    handball: [['6-0 Wall', '6-0 mur'], ['Wing Fast Break', 'Fløj-kontra'], ['Back Jump Shot', 'Bagspiller hopskud'], ['Pivot Screen', 'Streg-skærm'], ['3-6 Defense', '3-6 forsvar'], ['Crossing Play', 'Krydsspil'], ['Seven-Metre', 'Syvmeter'], ['Give & Go Wing', 'Aflever-løb fløj'], ['Spin Shot', 'Skrueskud'], ['5-1 Defense', '5-1 forsvar'], ['Wing Feint', 'Fløjfinte'], ['Backcourt Timing', 'Bagkæde-timing']],
    soccer: [['4-3-3 Build-up', '4-3-3 opspil'], ['Play from Back', 'Spil bagfra'], ['Offside Trap', 'Offside-fælde'], ['Wing Overlap', 'Fløj-overlap'], ['Through Ball', 'Gennemspil'], ['Press Triggers', 'Pres-triggere'], ['Corner Routine', 'Hjørne-rutine'], ['Free-kick Wall', 'Frisparksmur'], ['Striker Run', 'Angriberløb'], ['Side Switch', 'Sideskift'], ['Low Block', 'Lavt blok'], ['Counter Attack', 'Kontraangreb']],
    basketball: [['Pick & Roll', 'Pick & roll'], ['1-3-1 Zone', '1-3-1 zone'], ['Give & Go', 'Give & go'], ['Break Lanes', 'Kontrabaner'], ['Horns Set', 'Horns-opstilling'], ['Backdoor Cut', 'Backdoor-cut'], ['Inbound Play', 'Indkast-spil'], ['Pindown Screen', 'Pindown-skærm'], ['Motion Offense', 'Motion-angreb'], ['Zone Press', 'Zonepres'], ['Post-up Iso', 'Post-up iso'], ['Buzzer Beater', 'Buzzer-beater']],
    tennis: [['Baseline Rally', 'Grundlinje-duel'], ['Serve & Volley', 'Serv & volley'], ['Cross-court Drive', 'Cross-court drive'], ['Down the Line', 'Langs linjen'], ['Approach & Volley', 'Angreb & volley'], ['Drop Shot', 'Stopbold'], ['Topspin Lob', 'Topspin-lob'], ['Kick Serve', 'Kick-serv'], ['Return Deep', 'Dyb retur'], ['Inside-out Forehand', 'Inside-out forhånd'], ['Passing Shot', 'Passérslag'], ['Wide Serve Opener', 'Bred serv-åbning']],
    volleyball: [['5-1 Rotation', '5-1 rotation'], ['Serve-Receive W', 'Serve-modt. W'], ['Quick Middle', 'Hurtig midte'], ['Back-row Attack', 'Baglinje-angreb'], ['Setter Dump', 'Hæver-dump'], ['Double Block', 'Dobbeltblok'], ['Libero Cover', 'Libero-dækning'], ['Slide Attack', 'Slide-angreb'], ['Pipe Set', 'Pipe-hævning'], ['Jump Serve', 'Jump-serve'], ['Read Block', 'Læse-blok'], ['Tandem Attack', 'Tandem-angreb']],
    baseball: [['Field Positions', 'Markpositioner'], ['Double Play', 'Double-play'], ['Cutoff Relay', 'Cutoff-relæ'], ['Bunt Defense', 'Bunt-forsvar'], ['Steal Second', 'Steal 2. base'], ['Outfield Align', 'Outfield-opstil'], ['Rundown', 'Rundown'], ['Hit & Run', 'Hit & run'], ['Pickoff Move', 'Pickoff'], ['Infield In', 'Infield-in'], ['Squeeze Play', 'Squeeze'], ['Sacrifice Bunt', 'Offer-bunt']],
    rugby: [['Scrum Set', 'Scrum-opstil'], ['Lineout Lift', 'Lineout-løft'], ['Ruck Cleanout', 'Ruck-oprydning'], ['Backline Move', 'Baglinje-træk'], ['Offload', 'Offload'], ['Maul Drive', 'Maul-drev'], ['Defensive Line', 'Forsvarslinje'], ['Switch Play', 'Switch-spil'], ['Box Kick', 'Box-kick'], ['Phase Play', 'Phase-play'], ['Cross Kick', 'Cross-kick'], ['Pick & Go', 'Pick & go']],
    football: [['I-Formation', 'I-formation'], ['Slant-Flat', 'Slant-flat'], ['Zone Blocking', 'Zone-blocking'], ['Play-Action', 'Play-action'], ['QB Drop', 'QB-drop'], ['Cover-2', 'Cover-2'], ['Blitz Package', 'Blitz-pakke'], ['Screen Pass', 'Screen-pasning'], ['Read Option', 'Read-option'], ['Shotgun Spread', 'Shotgun-spread'], ['Goal-line Stand', 'Goal-line stand'], ['Two-minute Drill', 'To-minutters']],
    badminton: [['Ready Base', 'Klar-base'], ['High Serve', 'Høj serv'], ['Net Drop', 'Net-drop'], ['Clear to Back', 'Clear til bag'], ['Smash & Follow', 'Smash & følg'], ['Doubles Rotation', 'Double-rotation'], ['Drive Exchange', 'Drive-udveksling'], ['Deceptive Slice', 'Vildledende slice'], ['Backhand Clear', 'Baghånds-clear'], ['Front-Back Defense', 'Front-bag forsvar'], ['Net Kill', 'Net-kill'], ['Flick Serve', 'Flick-serv']],
    snooker: [['Opening Break', 'Åbningsstød'], ['Long Pot', 'Langt sænk'], ['Screw Back', 'Skrue tilbage'], ['Stun Shot', 'Stun-stød'], ['Top Spin', 'Topspin'], ['Safety to Baulk', 'Safety til baulk'], ['Plant the Reds', 'Plant de røde'], ['Double to Corner', 'Dobbelt til hjørne'], ['Cannon Position', 'Cannon-position'], ['Break Builder', 'Break-opbygning'], ['Colour Clearance', 'Farve-clearance'], ['Match Ball', 'Matchbold']],
    pool: [['Break Rack', 'Break-stød'], ['Run the Table', 'Ryd bordet'], ['Safety Snooker', 'Safety-snooker'], ['Bank Shot', 'Bande-stød'], ['Combo Shot', 'Kombi-stød'], ['Cut to Corner', 'Skær til hjørne'], ['Draw Shot', 'Træk-stød'], ['Follow Shot', 'Følge-stød'], ['Carom Play', 'Carom-spil'], ['Position Play', 'Positionsspil'], ['Side Pocket', 'Sidehul'], ['8-Ball Finish', '8-bold afslutning']],
    darts: [['Treble 20', 'Trippel 20'], ['Treble 19', 'Trippel 19'], ['Bullseye', 'Bullseye'], ['Checkout 170', 'Checkout 170'], ['Checkout 121', 'Checkout 121'], ['Double 16', 'Dobbelt 16'], ['Double 20', 'Dobbelt 20'], ['Scatter Cover', 'Spredning'], ['Big Fish 170', 'Big Fish 170'], ['Shanghai', 'Shanghai'], ['Around the Clock', 'Rundt på uret'], ['Bounce-out Cover', 'Bounce-out']],
    icehockey: [['Power Play', 'Overtal'], ['Penalty Kill', 'Undertal'], ['Breakout', 'Udbrud'], ['Neutral Zone Trap', 'Neutral zone-fælde'], ['Cycle Down Low', 'Cykling i hjørnet'], ['Point Shot', 'Skud fra blå linje'], ['One-Timer Play', 'One-timer spil'], ['Give & Go', 'Aflever & løb'], ['Dump and Chase', 'Dump and chase'], ['Odd-Man Rush', 'Overtalsangreb'], ['Faceoff Set', 'Faceoff-opstilling'], ['Line Change', 'Skift']],
    floorball: [['Power Play', 'Overtal'], ['Box Defense', 'Boks-forsvar'], ['Breakout', 'Udbrud'], ['2-2-1 Press', '2-2-1 pres'], ['Screen Shot', 'Skærmskud'], ['Cross Pass', 'Tværaflevering'], ['Give & Go', 'Aflever & løb'], ['Slot Attack', 'Slot-angreb'], ['Corner Play', 'Hjørnespil'], ['Rush Attack', 'Kontraangreb'], ['Faceoff Set', 'Faceoff-opstilling'], ['Man-Down Defense', 'Undertals-forsvar']],
    chess: [
      ['Fork King & Queen', 'Gaffel på konge og dame'], ['Knight Fork Family', 'Springergaffel-familie'], ['Royal Fork', 'Kongelig gaffel'], ['Absolute Pin', 'Absolut binding'], ['Relative Pin', 'Relativ binding'], ['Break the Pin', 'Bryd bindingen'], ['Skewer the King', 'Spyd på kongen'], ['Discovered Attack', 'Opdækkerangreb'], ['Discovered Check', 'Opdækkerskak'], ['Double Check', 'Dobbeltskak'],
      ['Double Attack', 'Dobbeltangreb'], ['Deflection', 'Bortledning'], ['Decoy Sacrifice', 'Lokkeoffer'], ['Overloaded Defender', 'Overbelastet forsvarer'], ['Removing the Defender', 'Fjern forsvareren'], ['Zwischenzug', 'Mellemtræk'], ['Back-Rank Mate', 'Grundlinjemat'], ['Back-Rank Weakness', 'Grundlinjesvaghed'], ['Smothered Mate', 'Kvælningsmat'], ["Anastasia's Mate", 'Anastasias mat'],
      ['Arabian Mate', 'Arabisk mat'], ["Boden's Mate", 'Bodens mat'], ["Legall's Mate", 'Legalls mat'], ['The Windmill', 'Vejrmøllen'], ['Greek Gift Bxh7+', 'Græsk offer Lxh7+'], ['Double Bishop Sacrifice', 'Dobbelt løberoffer'], ['Rook Lift', 'Tårnløft'], ['Exchange Sacrifice', 'Kvalitetsoffer'], ['Queen Sacrifice', 'Dameoffer'], ['Clearance Sacrifice', 'Rydningsoffer'],
      ['Interference', 'Afspærring'], ['X-Ray Attack', 'Røntgenangreb'], ['Battery on the Diagonal', 'Batteri på diagonalen'], ['Battery on the File', 'Batteri på linjen'], ['Trapped Piece', 'Fanget brik'], ['Trap the Queen', 'Fang damen'], ['Perpetual Check', 'Evig skak'], ['Fortress Draw', 'Fæstningsremis'], ['Underpromotion to Knight', 'Underforvandling til springer'], ['Promotion Race', 'Forvandlingskapløb'],
      ['Passed Pawn Push', 'Fremrykning af fribonde'], ['Protected Passed Pawn', 'Beskyttet fribonde'], ['Outside Passed Pawn', 'Ydre fribonde'], ['Connected Passed Pawns', 'Forbundne fribønder'], ['The Opposition', 'Oppositionen'], ['Distant Opposition', 'Fjern opposition'], ['Triangulation', 'Triangulering'], ['Zugzwang', 'Træktvang'], ['King & Pawn Endgame', 'Konge- og bondeslutspil'], ['Lucena Position', 'Lucena-stilling'],
      ['Philidor Defense', 'Philidor-forsvar'], ['Rook Behind Passed Pawn', 'Tårn bag fribonden'], ['Bishop vs Knight Endgame', 'Løber mod springer'], ['Opposite-Colored Bishops', 'Uligefarvede løbere'], ['Minority Attack', 'Minoritetsangreb'], ['Pawn Storm on the King', 'Bondestorm mod kongen'], ['Open the h-File', 'Åbn h-linjen'], ['Sacrifice on f7', 'Offer på f7'], ['Sacrifice on h6', 'Offer på h6'], ['Overprotect e5', 'Overbeskyt e5'],
      ['Control the Open File', 'Behersk den åbne linje'], ['Seventh-Rank Rook', 'Tårn på syvende række'], ['Knight Outpost', 'Springerforpost'], ['Good vs Bad Bishop', 'God mod dårlig løber'], ['Bishop Pair Advantage', 'Løberpar-fordel'], ['Fianchetto the Bishop', 'Fianchetto af løberen'], ['Isolated Queen Pawn', 'Isoleret dronningebonde'], ['Blockade the Pawn', 'Bloker bonden'], ['Play vs Doubled Pawns', 'Spil mod dobbeltbønder'], ['Pawn Break d5', 'Bondegennembrud d5'],
      ['Central Break e4', 'Centralt gennembrud e4'], ['Space Advantage', 'Pladsfordel'], ['Prophylaxis', 'Profylakse'], ['Overloading Defense', 'Overbelastning af forsvar'], ['Attack the Castled King', 'Angrib den rokerede konge'], ['Opposite-Side Castling Attack', 'Angreb ved modsat rokade'], ['Rook Sacrifice on h-File', 'Tårnoffer på h-linjen'], ['Deflect the Guard', 'Bortled vagten'], ['Mating Net', 'Matnet'], ['Quiet Move', 'Stille træk'],
      ['In-Between Check', 'Mellemskak'], ['Desperado', 'Desperado'], ['Counterattack in the Center', 'Modangreb i centrum'], ['Sicilian Najdorf Plan', 'Siciliansk Najdorf-plan'], ["King's Indian Attack", 'Kongeindisk angreb'], ["Kasparov's e5 Break", 'Kasparovs e5-gennembrud'], ['Kasparov–Topalov 1999', 'Kasparov–Topalov 1999'], ["Queen's Gambit Plan", 'Dronninggambit-plan'], ['Ruy Lopez Center', 'Spansk center'], ['Evans Gambit Attack', 'Evans-gambit-angreb'],
      ['Develop with Tempo', 'Udvikl med tempo'], ['Seize the Initiative', 'Grib initiativet'], ['Centralize the Knight', 'Centraliser springeren'], ['Improve the Worst Piece', 'Forbedr den dårligste brik'], ['Trade to a Won Endgame', 'Byt til vundet slutspil'], ['Create a Second Weakness', 'Skab en anden svaghed'], ['Two Weaknesses Principle', 'Princippet om to svagheder'], ['Convert Material Advantage', 'Omsæt materiel fordel'], ['Calculate Forcing Lines', 'Beregn tvungne varianter'], ['Blunder-Check Routine', 'Fejltjek-rutine']
    ],
    bridge: [
      ['Stayman Convention', 'Stayman-konvention'], ['Jacoby Transfer', 'Jacoby-transfer'], ['Texas Transfer', 'Texas-transfer'], ['Blackwood 4NT', 'Blackwood 4UT'], ['Roman Key Card Blackwood', 'Roman Key Card Blackwood'], ['Gerber 4♣', 'Gerber 4♣'], ['Takeout Double', 'Oplysningsdobling'], ['Negative Double', 'Negativ dobling'], ['Penalty Double', 'Strafdobling'], ['Weak Two Opening', 'Svag to-åbning'],
      ['Strong 2♣ Opening', 'Stærk 2♣-åbning'], ['Preemptive Three-Bid', 'Spærremelding på tre'], ['Overcall 1NT', '1UT-indmelding'], ['Unusual 2NT', 'Usædvanlig 2UT'], ['Michaels Cuebid', 'Michaels cuebid'], ['Fourth Suit Forcing', 'Fjerde farve krav'], ['New Minor Forcing', 'Ny lavfarve krav'], ['Splinter Bid', 'Splinter-melding'], ['Cuebid Slam Try', 'Cuebid slemforsøg'], ['Control-Showing Cuebid', 'Kontrol-cuebid'],
      ['Jacoby 2NT', 'Jacoby 2UT'], ['Bergen Raises', 'Bergen-støtte'], ['Drury Convention', 'Drury-konvention'], ['Lebensohl', 'Lebensohl'], ['Puppet Stayman', 'Puppet Stayman'], ['Smolen Transfer', 'Smolen-transfer'], ['Landy Convention', 'Landy-konvention'], ['Cappelletti Defense', 'Cappelletti-forsvar'], ['DONT Defense', 'DONT-forsvar'], ['Support Double', 'Støttedobling'],
      ['Responsive Double', 'Svar-dobling'], ['Lead-Directing Double', 'Udspilsdobling'], ['Fourth-Best Lead', 'Udspil: fjerdehøjeste'], ['Rule of Eleven', 'Regel om elleve'], ['Top of Nothing Lead', 'Top af intet'], ['Attitude Signal', 'Holdningssignal'], ['Count Signal', 'Tællesignal'], ['Suit Preference Signal', 'Farvepræference-signal'], ['Smith Echo', 'Smith-ekko'], ['Trump Echo', 'Trumf-ekko'],
      ['Finesse the Queen', 'Knib mod damen'], ['Double Finesse', 'Dobbeltknibning'], ['Ruffing Finesse', 'Trumfknibning'], ['Backward Finesse', 'Baglæns knibning'], ['Two-Way Finesse', 'Tovejsknibning'], ['Hold-Up Play', 'Holdop-spil'], ['Ducking Play', 'Duk-spil'], ['Establish a Long Suit', 'Etabler en lang farve'], ['Cross-Ruff', 'Krydstrumfning'], ['Dummy Reversal', 'Blindemands-omvending'],
      ['Trump Coup', 'Trumfkup'], ['Grand Coup', 'Storekup'], ['Trump Reduction', 'Trumfreduktion'], ['Elimination Play', 'Elimineringsspil'], ['Strip & Endplay', 'Strip og slutspil'], ['Throw-In Play', 'Indkast-spil'], ['Loser-on-Loser', 'Taber-på-taber'], ['Avoidance Play', 'Undgåelses-spil'], ['Safety Play', 'Sikkerhedsspil'], ['Simple Squeeze', 'Simpel squeeze'],
      ['Automatic Squeeze', 'Automatisk squeeze'], ['Double Squeeze', 'Dobbelt-squeeze'], ['Trump Squeeze', 'Trumf-squeeze'], ['Progressive Squeeze', 'Progressiv squeeze'], ['Vienna Coup', 'Wienerkup'], ['Criss-Cross Squeeze', 'Kryds-squeeze'], ['Show-Up Squeeze', 'Vis-frem-squeeze'], ["Morton's Fork Coup", 'Mortons gaffel-kup'], ['Bath Coup', 'Bath-kup'], ['Deschapelles Coup', 'Deschapelles-kup'],
      ['Merrimac Coup', 'Merrimac-kup'], ['Scissors Coup', 'Sakse-kup'], ['Counting the Hand', 'Tæl hånden'], ['Counting Distribution', 'Tæl fordelingen'], ['Counting Winners in NT', 'Tæl stik i sans'], ['Counting Losers', 'Tæl tabere'], ['Plan the Play', 'Planlæg spillet'], ['Manage Entries', 'Håndter indkomster'], ['Preserve Communications', 'Bevar forbindelser'], ['Unblock the Suit', 'Frigør farven'],
      ['Hold Up in No Trump', 'Holdop i sans'], ["Attack Dummy's Entry", 'Angrib blindemands indkomst'], ['Passive Defense', 'Passivt forsvar'], ['Active Defense', 'Aktivt forsvar'], ['Forcing Defense', 'Tvingende forsvar'], ['Uppercut Ruff', 'Uppercut-trumfning'], ['Trump Promotion', 'Trumfforfremmelse'], ['Second Hand Low', 'Anden hånd lavt'], ['Third Hand High', 'Tredje hånd højt'], ['Cover an Honor', 'Dæk en honnør'],
      ['Sacrifice Bid', 'Offermelding'], ['Save Against Game', 'Redning mod udspil'], ['Balancing Bid', 'Balancemelding'], ['Competitive Double', 'Konkurrence-dobling'], ['Law of Total Tricks', 'Loven om totale stik'], ['Invite Game with 2NT', 'Inviter med 2UT'], ['Slam Force Sequence', 'Slemtvingende sekvens'], ['Grand Slam Force', 'Storeslem-tvang'], ['Signal for a Switch', 'Signal for skift'], ['Defend the Endgame', 'Forsvar slutspillet']
    ],
    poker: [
      ['Play Tight Early', 'Spil stramt tidligt'], ['Position Awareness', 'Positionsbevidsthed'], ['Open-Raise in Position', 'Åbn med raise i position'], ['3-Bet for Value', '3-bet for værdi'], ['3-Bet Bluff', '3-bet bluff'], ['Light 4-Bet', 'Let 4-bet'], ['Continuation Bet', 'Fortsættelsesbet'], ['Double Barrel', 'Dobbelt barrel'], ['Triple Barrel Bluff', 'Tredobbelt barrel-bluff'], ['Check-Raise', 'Check-raise'],
      ['Thin Value Bet', 'Tynd værdibet'], ['Pot Odds Call', 'Pot odds-syn'], ['Implied Odds', 'Implicerede odds'], ['Reverse Implied Odds', 'Omvendte implicerede odds'], ['Semi-Bluff Draw', 'Semi-bluff træk'], ['Float the Flop', 'Float på floppet'], ['Delayed C-Bet', 'Forsinket c-bet'], ['Probe Bet', 'Probe-bet'], ['Blocking Bet', 'Blokeringsbet'], ['Overbet for Value', 'Overbet for værdi'],
      ['Bluff the Scare Card', 'Bluff skræmmekortet'], ['Range Merging', 'Range-sammensmeltning'], ['Polarized Range', 'Polariseret range'], ['Balanced Betting', 'Balanceret betting'], ['Isolate the Limper', 'Isolér limperen'], ['Squeeze Play', 'Squeeze-spil'], ['Steal the Blinds', 'Stjæl blinds'], ['Defend the Big Blind', 'Forsvar big blind'], ['Small Blind Complete', 'Small blind-komplet'], ['Button Aggression', 'Button-aggression'],
      ['Set Mining', 'Set mining'], ['Suited Connectors', 'Suited connectors'], ['Play Pocket Pairs', 'Spil lommepar'], ['Broadway Hands', 'Broadway-hænder'], ['Fold Weak Aces', 'Kast svage esser'], ['Trap with the Nuts', 'Fælde med nutsene'], ['Slow-Play a Monster', 'Langsomspil et monster'], ['Fast-Play Draws', 'Hurtigspil træk'], ['Bet-Fold Discipline', 'Bet-fold disciplin'], ['Bet-Call the River', 'Bet-call på river'],
      ['Bluff-Catch', 'Bluff-catch'], ['Hero Call', 'Hero call'], ['Fold to Aggression', 'Kast mod aggression'], ['Read the Board Texture', 'Læs bordteksturen'], ['Wet vs Dry Boards', 'Våde mod tørre borde'], ['Range Advantage', 'Range-fordel'], ['Nut Advantage', 'Nut-fordel'], ['Barrel Scare Cards', 'Barrel på skræmmekort'], ['Give Up the Turn', 'Opgiv turn'], ['Pot Control', 'Pot-kontrol'],
      ['Thin Value River', 'Tynd værdi på river'], ['Blocker Bluff', 'Blocker-bluff'], ['Remove Their Value', 'Fjern deres værdi'], ['Equity Realization', 'Equity-realisering'], ['Fold Equity', 'Fold equity'], ['ICM Awareness', 'ICM-bevidsthed'], ['Bubble Play', 'Bubble-spil'], ['Short-Stack Shove', 'Short-stack shove'], ['Big-Stack Pressure', 'Big-stack pres'], ['Re-Steal All-In', 'Re-steal all-in'],
      ['Min-Raise Preflop', 'Min-raise preflop'], ['Limp-Reraise Trap', 'Limp-reraise fælde'], ['Open-Shove Range', 'Open-shove range'], ['Call Off Correctly', 'Call af korrekt'], ['Fold Big Preflop', 'Kast stort preflop'], ['Own the Turn', 'Ejerskab af turn'], ['Deny Equity', 'Nægt equity'], ['Protect Your Hand', 'Beskyt din hånd'], ['Bet-Sizing Tells', 'Bet-størrelse tells'], ['Exploit the Fish', 'Udnyt fisken'],
      ['Adjust to the Table', 'Tilpas til bordet'], ['Tighten vs Aggro', 'Stram op mod aggro'], ['Widen vs Nits', 'Udvid mod nits'], ['Table Image Play', 'Bordimage-spil'], ['Timing Tells', 'Timing-tells'], ['Physical Tells', 'Fysiske tells'], ['Bet-Sizing Balance', 'Bet-størrelse balance'], ['Merge on Rivers', 'Sammensmelt på river'], ['Exploit Overfolders', 'Udnyt overfoldere'], ['Exploit Underbluffers', 'Udnyt underbluffere'],
      ['Check Behind for SDV', 'Check bagved for SDV'], ['Realize Showdown Value', 'Realisér showdown-værdi'], ['Turn Made Hand to Bluff', 'Lav hånd om til bluff'], ['Blocker Overbet', 'Blocker-overbet'], ['River Overbet Bluff', 'River overbet-bluff'], ['Donk Bet Line', 'Donk-bet linje'], ['Stab at Weakness', 'Stik efter svaghed'], ['Cap Your Range', 'Cap din range'], ['Uncap with Traps', 'Uncap med fælder'], ['Multiway Caution', 'Multiway-forsigtighed'],
      ['Cold 4-Bet Bluff', 'Kold 4-bet bluff'], ['Flat in Position', 'Flad i position'], ['Overlimp the Button', 'Overlimp button'], ['Attack the Limpers', 'Angrib limpere'], ['Cut Your Own Value', 'Skær din værdi'], ['Bankroll Management', 'Bankroll-styring'], ['Tilt Control', 'Tilt-kontrol'], ['Game Selection', 'Spilvalg'], ['Study Solvers', 'Studér solvers'], ['Review Your Hands', 'Gennemgå dine hænder']
    ],
    backgammon: [
      ['Split the Back Checkers', 'Del de bageste brikker'], ['Slot the 5-Point', 'Slot 5-punktet'], ['Make the Bar Point', 'Lav bar-punktet'], ['Build a Prime', 'Byg en prime'], ['Make Your 5-Point', 'Lav dit 5-punkt'], ['Make the Golden Point', 'Lav det gyldne punkt'], ['Anchor on the 20', 'Anker på 20-punktet'], ['Advanced Anchor', 'Avanceret anker'], ['Run a Back Checker', 'Løb en bagbrik'], ['Escape the Deep Anchor', 'Flygt fra det dybe anker'],
      ['Hit and Run', 'Ram og løb'], ['Hit and Cover', 'Ram og dæk'], ['Double Hit', 'Dobbelt-ram'], ['Blitz the Board', 'Blitz brættet'], ['Attack the Blot', 'Angrib blotten'], ['Point on the Head', 'Point på hovedet'], ['Make an Inner Point', 'Lav et inderpunkt'], ['Build the Home Board', 'Byg hjemmebrættet'], ['Prime vs Prime', 'Prime mod prime'], ['Break the Anchor', 'Bryd ankeret'],
      ['Run the Race', 'Kør ræset'], ['Race to Bear Off', 'Ræs til afbæring'], ['Count the Pips', 'Tæl pippene'], ['Take the Pip Lead', 'Tag pip-føringen'], ['Duplicate the Numbers', 'Dupliker tallene'], ['Diversify Shots', 'Diversificer skud'], ['Minimize Return Shots', 'Minimer retur-skud'], ['Safe vs Bold Play', 'Sikkert mod modigt'], ['Cover the Blot', 'Dæk blotten'], ['Unstack Heavy Points', 'Fordel tunge punkter'],
      ['Build Efficiently', 'Byg effektivt'], ['Play a Holding Game', 'Spil et holdespil'], ['High Anchor Holding', 'Højt anker-hold'], ['Low Anchor Holding', 'Lavt anker-hold'], ['Time a Back Game', 'Tim et bagspil'], ['1-3 Back Game', '1-3 bagspil'], ['1-4 Back Game', '1-4 bagspil'], ['2-4 Back Game', '2-4 bagspil'], ['Keep Your Timing', 'Bevar din timing'], ['Avoid a Crunch', 'Undgå sammenbrud'],
      ['Extend the Prime', 'Udvid primen'], ['Roll the Prime Forward', 'Rul primen frem'], ['Contain the Anchor', 'Indeslut ankeret'], ['Prime and Attack', 'Prime og angrib'], ['Ace-Point Game', 'Es-punkt spil'], ['Deuce-Point Game', 'To-punkt spil'], ['Golden Anchor Defense', 'Gyldent anker-forsvar'], ['Escape Under the Prime', 'Flygt under primen'], ['Jump the Prime', 'Spring over primen'], ['Clear the Midpoint', 'Ryd midterpunktet'],
      ['Double for Value', 'Dobl for værdi'], ['Double the Race Lead', 'Dobl med føring'], ['Initial Double', 'Første dobling'], ['Redouble', 'Redobling'], ['Take or Pass', 'Tag eller pas'], ['25% Take Point', '25% tag-punkt'], ['Beaver the Cube', 'Beaver terningen'], ['Play for a Gammon', 'Spil for gammon'], ['Avoid the Gammon', 'Undgå gammon'], ['Cube Leverage', 'Terning-løftestang'],
      ['Too Good to Double', 'For god til at dobl'], ['Play On for Gammon', 'Spil videre for gammon'], ['Cash the Game', 'Indløs spillet'], ['Count Market Losers', 'Tæl markedstabere'], ['Doubling Window', 'Doblings-vindue'], ['Recirculate a Checker', 'Recirkuler en brik'], ['Volatile-Position Double', 'Dobling i volatil stilling'], ['Positional Double', 'Positionsdobling'], ['Race + Threat Double', 'Ræs + trussel-dobling'], ['Last-Roll Double', 'Sidste-kast dobling'],
      ['Bear Off Safely', 'Bær sikkert af'], ['Fill the Gaps', 'Fyld hullerne'], ['Avoid Wastage', 'Undgå spild'], ['Cross Over Efficiently', 'Krydsspil effektivt'], ['Bear Off vs Contact', 'Afbæring med kontakt'], ['Leave Fewest Shots', 'Efterlad færrest skud'], ['Clear from the Rear', 'Ryd bagfra'], ['Even Out the Stacks', 'Jævn stakkene'], ['Keep Contact When Behind', 'Bevar kontakt bagfra'], ['Save the Gammon', 'Red gammonen'],
      ['Opening 3-1 Make the 5', 'Åbning 3-1 lav 5'], ['Opening 6-1 Bar Point', 'Åbning 6-1 bar-punkt'], ['Opening 4-2 Make the 4', 'Åbning 4-2 lav 4'], ['Opening 6-5 Lover Leap', 'Åbning 6-5 elskerspring'], ['Opening 5-3 Make the 3', 'Åbning 5-3 lav 3'], ['Opening 6-4 Run or Build', 'Åbning 6-4 løb eller byg'], ['Opening 2-1 Slot or Split', 'Åbning 2-1 slot eller del'], ['Opening 5-1 Split', 'Åbning 5-1 del'], ['Opening 6-3 Run', 'Åbning 6-3 løb'], ['Opening 6-2 Run or Split', 'Åbning 6-2 løb eller del'],
      ['Reply to a Hit', 'Svar på et ram'], ['Enter from the Bar', 'Kom ind fra baren'], ['Dance on the Bar', 'Dans på baren'], ['Anchor After Being Hit', 'Anker efter ram'], ['Time Your Attack', 'Tim dit angreb'], ['Balance Board & Race', 'Balancér bræt og ræs'], ['Play the Match Score', 'Spil efter matchstilling'], ['Crawford Game Rule', 'Crawford-regel'], ['Post-Crawford Doubling', 'Post-Crawford dobling'], ['Review with a Bot', 'Gennemgå med en bot']
    ]
  };

  // Named tactical formations (reposition the 'def' players onto a shape).
  const FORMATIONS = {
    handball: [
      { name: { en: '6-0 Defense', da: '6-0 forsvar' }, def: [[30, 32], [42, 30], [50, 29], [58, 30], [70, 32], [50, 38]] },
      { name: { en: '5-1 Defense', da: '5-1 forsvar' }, def: [[30, 34], [42, 32], [58, 32], [70, 34], [50, 44], [50, 22]] },
      { name: { en: '3-2-1 Defense', da: '3-2-1 forsvar' }, def: [[35, 34], [50, 34], [65, 34], [40, 26], [60, 26], [50, 18]] }
    ],
    soccer: [
      { name: { en: '4-4-2', da: '4-4-2' }, def: [[50, 25], [30, 20], [70, 20], [42, 32], [58, 32]] },
      { name: { en: '4-3-3', da: '4-3-3' }, def: [[50, 22], [32, 26], [68, 26], [42, 32], [58, 32]] },
      { name: { en: '5-3-2', da: '5-3-2' }, def: [[50, 20], [28, 24], [72, 24], [40, 28], [60, 28]] }
    ],
    basketball: [
      { name: { en: 'Man-to-Man', da: 'Mand-til-mand' }, def: [[50, 30], [35, 40], [65, 40], [42, 22], [58, 22]] },
      { name: { en: '2-3 Zone', da: '2-3 zone' }, def: [[40, 24], [60, 24], [30, 40], [50, 42], [70, 40]] },
      { name: { en: '1-3-1 Zone', da: '1-3-1 zone' }, def: [[50, 20], [35, 34], [50, 34], [65, 34], [50, 46]] }
    ],
    volleyball: [
      { name: { en: '5-1 System', da: '5-1 system' }, def: [[30, 22], [50, 12], [70, 22], [30, 40], [50, 42], [70, 40]] },
      { name: { en: '6-2 System', da: '6-2 system' }, def: [[30, 20], [50, 14], [70, 20], [35, 40], [50, 44], [65, 40]] }
    ],
    football: [
      { name: { en: '4-3 Defense', da: '4-3 forsvar' }, def: [[30, 55], [43, 55], [57, 55], [70, 55], [50, 45]] },
      { name: { en: 'Nickel', da: 'Nickel' }, def: [[32, 55], [45, 55], [55, 55], [68, 55], [50, 42]] }
    ],
    rugby: [
      { name: { en: 'Flat Line', da: 'Flad linje' }, def: [[50, 40], [35, 40], [65, 40], [25, 42], [75, 42], [50, 46]] },
      { name: { en: 'Drift Defense', da: 'Drift-forsvar' }, def: [[50, 38], [38, 40], [62, 40], [26, 44], [74, 44], [50, 48]] }
    ],
    icehockey: [
      { name: { en: '1-2-2 Forecheck', da: '1-2-2 forecheck' }, def: [[50, 26], [40, 40], [60, 40], [40, 30], [60, 30]] },
      { name: { en: '2-1-2 Forecheck', da: '2-1-2 forecheck' }, def: [[40, 28], [60, 28], [50, 38], [40, 46], [60, 46]] },
      { name: { en: 'Neutral Zone Trap', da: 'Neutral zone-fælde' }, def: [[50, 30], [35, 42], [65, 42], [45, 48], [55, 48]] }
    ],
    floorball: [
      { name: { en: '2-2-1', da: '2-2-1' }, def: [[40, 30], [60, 30], [40, 42], [60, 42]] },
      { name: { en: '3-1 Box', da: '3-1 boks' }, def: [[35, 34], [50, 34], [65, 34], [50, 46]] }
    ]
  };

  const lang = () => (window.I18N && I18N.getLang && I18N.getLang()) || 'en';

  function plays(sportId) {
    const spec = SPECIFIC[sportId] || [];
    // Chess, bridge, poker & backgammon carry a full 100-item catalogue; others show 30.
    const cap = (sportId === 'chess' || sportId === 'bridge' || sportId === 'poker' || sportId === 'backgammon') ? spec.length : 30;
    return spec.concat(SHARED).slice(0, cap).map(p => ({ en: p[0], da: p[1] }));
  }
  function playName(sportId, index) {
    const p = plays(sportId)[index]; if (!p) return '';
    return p[lang()] || p.en;
  }
  function formations(sportId) {
    return (FORMATIONS[sportId] || []).map(f => ({ name: f.name[lang()] || f.name.en, def: f.def }));
  }

  // Apply a named formation: map its def[] onto the current 'def' objects.
  function applyFormation(objects, sportId, formationIndex) {
    const f = (FORMATIONS[sportId] || [])[formationIndex]; if (!f) return objects;
    const defs = objects.filter(o => o.kind === 'def' || o.team === 'def');
    f.def.forEach((pos, i) => { if (defs[i]) { defs[i].x = pos[0]; defs[i].y = pos[1]; } });
    return objects;
  }

  // Build a short animation (4 frames) for a system from the current objects.
  function buildPlay(objects, index, sportId) {
    // Board/mind games are conceptual (no piece choreography) — keep static.
    if (sportId === 'chess' || sportId === 'bridge' || sportId === 'poker' || sportId === 'backgammon') return [{ objects: clone(objects), shapes: [] }];
    const rnd = rng((index + 1) * 137 + sportId.length * 31 + 7);
    const base = clone(objects);
    const atk = base.filter(o => o.kind === 'player' && o.team === 'atk');
    const ballObj = base.find(o => o.kind === 'ball' || o.kind === 'cue');
    const goalY = 12;
    const frames = [{ objects: clone(base), shapes: [] }];
    let cur = clone(base);
    const steps = 3;
    for (let k = 1; k <= steps; k++) {
      cur = clone(cur);
      cur.forEach(o => {
        if (o.kind === 'player' && o.team === 'atk') { o.y += (goalY - o.y) * 0.14 + (rnd() * 6 - 3); o.x += (rnd() * 9 - 4.5); }
        else if (o.kind === 'player' && o.team === 'def') { o.x += (rnd() * 5 - 2.5); o.y += (rnd() * 4 - 2); }
        else if (o.kind === 'dart') { o.x = 50 + (rnd() * 30 - 15); o.y = 50 + (rnd() * 30 - 15); }
        else if (o.kind === 'cue' && o.id === 'cue') { o.x += (rnd() * 30 - 15); o.y += (rnd() * 26 - 16); }
        o.x = clamp(o.x, 6, 94); o.y = clamp(o.y, 8, 92);
      });
      const b = ballObj && cur.find(o => o.id === ballObj.id);
      if (b && ballObj.kind === 'ball') {
        if (k < steps && atk.length) { const t = cur.find(o => o.id === atk[k % atk.length].id); if (t) { b.x = t.x; b.y = t.y - 3; } }
        else { b.x = 50 + (rnd() * 20 - 10); b.y = goalY + 4; }
      }
      frames.push({ objects: cur, shapes: [] });
    }
    return frames;
  }

  return { plays, playName, formations, applyFormation, buildPlay, count: s => plays(s).length };
})();
if (typeof window !== 'undefined') window.PLAYBOOK = PLAYBOOK;

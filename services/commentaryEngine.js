'use strict';

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const SHOT_TYPES = [
  'a powerful right-footed drive into the bottom-left corner',
  'a delicate left-footed chip over the keeper',
  'a thunderous header from six yards out',
  'a precise low strike that nestled into the far post',
  'a stunning volley struck on the half-turn',
  'a curling effort with the outside of the boot',
  'a clinical near-post finish with his weaker foot',
  'an audacious backheel flick that wrong-footed the goalkeeper',
  'a fierce rising shot that flew into the top-right corner',
  'a composed side-footed slot into an empty net',
  'a thumping downward header that bounced past the keeper',
  'a venomous left-footed sidefoot finish from the edge of the box',
];

const BUILD_UP = [
  'After a slick one-two on the edge of the area,',
  'Breaking clear of the offside trap with blistering pace,',
  'Collecting a defence-splitting through ball,',
  'Latching onto a loose clearance,',
  'Spinning brilliantly away from his marker,',
  'Drifting inside from the left flank,',
  'Exploiting a massive gap in the defensive line,',
  'Controlling a long ball brilliantly on his chest,',
  'Ghosting into the penalty area unmarked,',
  'Picking the ball up deep and driving forward with purpose,',
  'Combining with a quick exchange in the box,',
  'Surging onto a perfectly weighted pass,',
];

const ASSIST_DESCRIPTIONS = [
  '{assister} played a perfectly-timed through ball splitting two defenders.',
  '{assister} whipped in a dangerous low cross from the right that asked all the right questions.',
  '{assister} delivered a floated ball into the box that was begging to be finished.',
  '{assister} picked out {scorer} with an inch-perfect cutback from the byline.',
  '{assister} played a pinpoint diagonal that unlocked the entire defensive structure.',
  '{assister} slid the ball into the corridor with a first-time deft touch.',
  '{assister} drove to the byline and squared it to {scorer} at the back post.',
  '{assister} chipped an exquisite ball over the defence for {scorer} to run onto.',
];

const GOAL_CLOSERS = [
  'The crowd erupts! What a moment for {scorer}!',
  'The stadium shakes with noise! Pure quality from {scorer}!',
  'Absolutely unstoppable! The goalkeeper didn\'t stand a chance!',
  'A brilliant goal — the technique was simply outstanding!',
  'That\'s a world-class finish! The fans are on their feet!',
  'Clinical! Ice in his veins! {scorer} doesn\'t miss those!',
  'An emphatic strike — the kind that will be replayed for years!',
  'Pure instinct from {scorer} — a truly sublime finish!',
];

const YELLOW_REASONS = [
  '{player} lunged in from behind with his studs showing — the referee had no choice.',
  '{player} cynically hauled down the attacker just outside the box, killing a dangerous counter.',
  '{player} reacted furiously to a decision, waving his arms and getting in the referee\'s face.',
  '{player} stamped on his opponent\'s ankle — reckless and completely unnecessary.',
  '{player} blatantly handled the ball on the edge of the area to stop a clear through ball.',
  '{player} time-wasted flagrantly on the ground after a routine challenge.',
  '{player} caught the striker high with an outstretched elbow.',
  '{player} deliberately blocked a quick free-kick restart, earning the inevitable caution.',
];

const YELLOW_CLOSERS = [
  'He has been warned. One more and he walks.',
  'The referee reaches into his pocket without hesitation.',
  'No complaints from the player — he knows what he did.',
  'The manager on the touchline buries his head in his hands.',
  'He will need to calm down significantly if he wants to stay on the pitch.',
];

const RED_REASONS = [
  '{player} launched himself into the tackle with two feet, catching his opponent above the knee — a horrific challenge.',
  '{player} raised both hands and struck his opponent in the face — the referee had no option but to dismiss him.',
  '{player} made a last-man challenge, wiping out the attacker when he was clean through on goal.',
  '{player} received a second yellow, having been warned just fifteen minutes earlier for dissent.',
  '{player} lost his composure entirely and shoved an opponent in the chest after a mistimed tackle.',
  '{player} raked his studs down an opponent\'s calf in a completely needless moment of madness.',
];

const RED_CLOSERS = [
  'Ten men now. This changes everything.',
  'The manager will be furious — and rightly so. An inexcusable decision.',
  'There can be absolutely no complaints. That was dangerous and reckless.',
  'The crowd reacts with gasps. His teammates are stunned.',
  'A huge turning point in this match. His team will have to dig deep.',
];

const INJURY_DESCRIPTIONS = [
  '{player} went down clutching his hamstring after stretching for a loose ball — a worrying sign for the medical staff.',
  '{player} collided knee-first with the advertising board chasing down a hopeless cause and is now writhing on the turf.',
  '{player} twisted his ankle awkwardly after landing badly from a challenge, and the physios are rushing on.',
  '{player} pulled up suddenly mid-sprint with what looks like a calf problem, grabbing the back of his leg.',
  '{player} took a firm elbow to the ribs and is now doubled over, receiving attention from the medical team.',
  '{player} landed heavily after an aerial challenge and is struggling to get to his feet.',
];

const INJURY_CLOSERS = [
  'He is signalling to the bench — he cannot continue. A significant blow for his side.',
  'The physio gestures to the touchline. This player is coming off.',
  'There are genuine looks of concern from his teammates. A cruel moment in the match.',
  'A worrying development. The crowd applauds as he is helped towards the tunnel.',
];

const SUB_DESCRIPTIONS = [
  '{in} comes on to inject some fresh energy as {out} trudges off having given his all.',
  'A tactical switch from the dugout: {in} on for {out}, changing the shape of the midfield.',
  '{out} receives a warm round of applause as he makes way; {in} sprints onto the pitch eager to impress.',
  'The manager makes his move: {in} replaces {out}, looking to add pace on the flank.',
  'With the game in the balance, {in} enters for {out} — a decision that could define the outcome.',
  '{out} has run himself into the ground; {in} comes on with a point to prove.',
];

const OWN_GOAL_DESCRIPTIONS = [
  '{player} stretched desperately to cut out a low cross and diverted the ball into his own net — a cruel, deflected finish.',
  '{player} rose to head clear a dangerous corner but could only direct it over his own goalkeeper and into the goal.',
  '{player} got his angles horribly wrong attempting to shepherd the ball back to his keeper, and it trickled inside the post.',
  '{player} lunged to block a shot at close range and the ball cannoned off his knee and into the net.',
  '{player} slipped at the crucial moment, and his clearance flew past a helpless goalkeeper into the top corner.',
];

const OWN_GOAL_CLOSERS = [
  'A nightmare moment for {player}. The stadium falls silent in disbelief.',
  'He will want to forget that one very quickly. A desperately unlucky own goal.',
  'Truly unfortunate — {player} could do little in that impossible position.',
  'The crowd doesn\'t know whether to laugh or cry. Neither does the goalkeeper.',
];

const DANGEROUS_PLAY_DESCRIPTIONS = [
  '{player} lunged in with both feet raised, endangering his opponent\'s safety — the referee saw it immediately.',
  '{player} elbowed his marker deliberately off the ball, away from the referee\'s line of sight — but the linesman flagged.',
  '{player} reacted to the challenge with a violent stamp on his opponent\'s trailing leg. An ugly moment.',
  '{player} kicked out in frustration after losing the ball, making contact with his opponent\'s thigh.',
  '{player} blocked his opponent\'s path with an outstretched forearm, sending him clattering to the ground.',
];

const DANGEROUS_PLAY_CLOSERS = [
  'The referee consults the assistant and produces the red card. No debate whatsoever.',
  'Dangerous and needless. His teammates are left shaking their heads.',
  'The crowd reacts immediately — that was over the line and everyone in the ground knew it.',
];

function n(p) { return (typeof p === 'string') ? p : (p && p.name) ? p.name : String(p); }

function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? n(vars[key]) : key));
}

function commentaryGoal(scorer, assister) {
  const build = pick(BUILD_UP);
  const shot = pick(SHOT_TYPES);
  const sn = n(scorer);
  const closer = fillTemplate(pick(GOAL_CLOSERS), { scorer: sn });
  if (assister) {
    const assistDesc = fillTemplate(pick(ASSIST_DESCRIPTIONS), { assister: n(assister), scorer: sn });
    return `${assistDesc} ${build} ${sn} finished with ${shot}. ${closer}`;
  }
  return `${build} ${sn} finished with ${shot}. ${closer}`;
}

function commentaryYellow(player) {
  const reason = fillTemplate(pick(YELLOW_REASONS), { player: n(player) });
  const closer = pick(YELLOW_CLOSERS);
  return `${reason} ${closer}`;
}

function commentaryRed(player) {
  const reason = fillTemplate(pick(RED_REASONS), { player: n(player) });
  const closer = pick(RED_CLOSERS);
  return `${reason} ${closer}`;
}

function commentaryInjury(player) {
  const desc = fillTemplate(pick(INJURY_DESCRIPTIONS), { player: n(player) });
  const closer = pick(INJURY_CLOSERS);
  return `${desc} ${closer}`;
}

function commentarySub(playerIn, playerOut) {
  return fillTemplate(pick(SUB_DESCRIPTIONS), { in: n(playerIn), out: n(playerOut) });
}

function commentaryOwnGoal(player) {
  const pn = n(player);
  const desc = fillTemplate(pick(OWN_GOAL_DESCRIPTIONS), { player: pn });
  const closer = fillTemplate(pick(OWN_GOAL_CLOSERS), { player: pn });
  return `${desc} ${closer}`;
}

function commentaryDangerousPlay(player) {
  const desc = fillTemplate(pick(DANGEROUS_PLAY_DESCRIPTIONS), { player: n(player) });
  const closer = pick(DANGEROUS_PLAY_CLOSERS);
  return `${desc} ${closer}`;
}

module.exports = {
  commentaryGoal,
  commentaryYellow,
  commentaryRed,
  commentaryInjury,
  commentarySub,
  commentaryOwnGoal,
  commentaryDangerousPlay,
};

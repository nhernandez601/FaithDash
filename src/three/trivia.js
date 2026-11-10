// Trivia for the coin gates: "Trek: His Story, Unit 1 - Creation Trivia Quiz" (Lessons 1.1-1.7), supplied by the owner.
// answer = index of the correct choice. True/False questions have two choices.
// To add or change questions, edit this list (keep the answer index pointing at the right choice).
const TF = ['True', 'False'];
export const TRIVIA = [
  { q: 'Men and women are the same, and their unique abilities as men and women are interchangeable.', c: TF, a: 1, ref: 'Lesson 1.5' },
  { q: 'According to Lesson 1.7, "true goodness" is defined as:', c: ['Our best efforts compared to others', 'A God-defined standard', 'Whatever feels right', 'The absence of sin'], a: 1, ref: 'Lesson 1.7' },
  { q: 'The key thought of Lesson 1.1 is that the Word, Jesus, God, is the:', c: ['Created Maker', 'Unmade Maker', 'Limited Maker', 'Alone Maker'], a: 1, ref: 'Lesson 1.1' },
  { q: 'Everything God made was very good in His eyes, and His goodness is the only true standard for comparison.', c: TF, a: 0, ref: 'Lesson 1.7' },
  { q: 'What was one aspect of the garden of Eden that God wanted to improve (even though creation was already good)?', c: ['The trees', 'That Adam was alone', 'The animals', 'The boundaries'], a: 1, ref: 'Lesson 1.7' },
  { q: 'The primary reason God created Eve was to be with Adam, who was all alone in his work in the garden of Eden.', c: TF, a: 0, ref: 'Lesson 1.5' },
  { q: 'The key verse "So God created man in His own image, in the image of God He created him; male and female He created them." is from:', c: ['Genesis 1:26', 'Genesis 1:27', 'Genesis 2:21-25', 'Mark 10:6'], a: 1, ref: 'Lesson 1.3' },
  { q: '"But from the beginning of creation, God made them male and female." is the key verse from:', c: ['Genesis 1:27', 'Genesis 2:24', 'Mark 10:6', 'John 1:14'], a: 2, ref: 'Lesson 1.5' },
  { q: 'Which verse contains: "Then God said, \'Let Us make man in Our image, after Our likeness. And let them have dominion...\'"?', c: ['Genesis 1:26', 'Genesis 1:27', 'Genesis 1:28', 'Genesis 2:15'], a: 0, ref: 'Lesson 1.6' },
  { q: 'Work is a bad thing that only came after Adam sinned.', c: TF, a: 1, ref: 'Lesson 1.6' },
  { q: 'God gave Adam and Eve important tasks such as naming the animals, multiplying, and tending the garden, and work is a God-given calling.', c: TF, a: 0, ref: 'Lesson 1.6' },
  { q: 'Universal boundaries and human limitations are part of God\'s design in the universe.', c: TF, a: 0, ref: 'Lesson 1.4' },
  { q: 'In Lesson 1.4, the key thought is that God gave Adam and Eve boundaries. He gives you and me:', c: ['Work only', 'Boundaries as well', 'No limits', 'Only freedom'], a: 1, ref: 'Lesson 1.4' },
  { q: 'God knows each person intimately, and this knowledge and care makes Him trustworthy as both Lord and friend.', c: TF, a: 0, ref: 'Lesson 1.3' },
  { q: 'According to the Unit 1 Review, what makes humans especially unique compared to the rest of God\'s creation?', c: ['They can talk', 'God made them in His image', 'They live in a garden', 'They have no limitations'], a: 1, ref: 'Unit 1 Review' },
  { q: 'What does the key word "Imago Dei" mean?', c: ['Creation out of nothing', 'Image of God', 'Unique and special', 'Boundary or limit'], a: 1, ref: 'Lesson 1.3' },
  { q: 'What is the key word for Lesson 1.5 (Male and Female - I\'m Not Alone)?', c: ['Dominion', 'Unique', 'Boundary', 'Goodness'], a: 1, ref: 'Lesson 1.5' },
  { q: 'Which is the key verse for Lesson 1.1 (Before the Beginning Began)?', c: ['Genesis 1:1-31', 'John 1:1-3', 'Romans 4:17', 'Job 38:4, 10-11'], a: 1, ref: 'Lesson 1.1' },
  { q: 'The key verse "And God saw everything that He had made, and behold, it was very good." is from:', c: ['Genesis 1:1', 'Genesis 1:31', 'John 1:3', 'Romans 4:17'], a: 1, ref: 'Lesson 1.7' },
  { q: 'All Christians are invited to be a witness for Jesus, the creator of the universe, similar to John the Baptist.', c: TF, a: 0, ref: 'Lesson 1.1' },
  { q: 'What does "Creatio ex nihilo" mean?', c: ['Image of God', 'Creation out of nothing', 'True goodness', 'God\'s calling'], a: 1, ref: 'Lesson 1.2' },
  { q: 'What is the key word defined in Lesson 1.1?', c: ['Imago Dei', 'Genesis: beginnings, creation or generations', 'Calling', 'Unique'], a: 1, ref: 'Lesson 1.1' },
  { q: 'According to Lesson 1.6, what does the key word "Calling" mean?', c: ['Something that indicates bounds or limits', 'The purpose that God has for your life', 'Having no like or equal', 'A God-defined standard of goodness'], a: 1, ref: 'Lesson 1.6' },
  { q: 'The key verses about God\'s boundaries (from Job) are:', c: ['Job 1:1', 'Job 38:4, 10-11', 'Genesis 2:8-17', 'Psalm 19:1'], a: 1, ref: 'Lesson 1.4' },
  { q: 'Lesson 1.4\'s main Scripture reference is:', c: ['Genesis 1:26-27', 'Genesis 2:8-17', 'John 1:1-13', 'Genesis 1:31'], a: 1, ref: 'Lesson 1.4' },
  { q: 'All physical things in the universe, even man-made objects, have a cause.', c: TF, a: 0, ref: 'Lessons 1.1 & 1.2' },
  { q: 'Humans being created in the image of God means they are the same as God.', c: TF, a: 1, ref: 'Lesson 1.3' },
  { q: 'The key verse for "creation out of nothing" (Lesson 1.2) is:', c: ['Genesis 1:1', 'Romans 4:17', 'John 1:1-3', 'Hebrews 11:3'], a: 1, ref: 'Lesson 1.2' },
];

// A deck that deals every question once (shuffled) before any repeats. Multiple-choice answers are shuffled too.
export function triviaDeck(rand = Math.random) {
  let pile = [];
  return () => {
    if (!pile.length) { pile = TRIVIA.map((_, i) => i); for (let i = pile.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; } }
    const t = TRIVIA[pile.pop()];
    if (t.c === TF) return { q: t.q, choices: [...TF], answer: t.a, ref: t.ref };
    const order = t.c.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return { q: t.q, choices: order.map((i) => t.c[i]), answer: order.indexOf(t.a), ref: t.ref };
  };
}

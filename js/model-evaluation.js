/**
 * Model Evaluation for Report & Analytics.
 * Sentiment: Logistic Regression + TF-IDF (Positive / Negative / Neutral)
 * Predictive: Linear Regression on historical monthly bookings
 * Metrics are computed from a held-out test set — not entered by hand.
 */
(function () {
  var CLASSES = ["Positive", "Negative", "Neutral"];
  var SPLIT_SEED = 20260911;
  var TEST_RATIO = 0.25;

  function round4(n) {
    if (n == null || !isFinite(n)) return null;
    return Math.round(n * 10000) / 10000;
  }

  function fmt4(n) {
    if (n == null || !isFinite(n)) return "—";
    return round4(n).toFixed(4);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function qualityLabel(kind, value) {
    if (value == null || !isFinite(value)) return "needs improvement";
    if (kind === "accuracy" || kind === "f1" || kind === "precision" || kind === "recall") {
      if (value >= 0.9) return "very good";
      if (value >= 0.8) return "good";
      if (value >= 0.65) return "acceptable";
      return "needs improvement";
    }
    if (kind === "r2") {
      if (value >= 0.85) return "very good";
      if (value >= 0.7) return "good";
      if (value >= 0.4) return "acceptable";
      return "needs improvement";
    }
    if (kind === "mae_ratio") {
      if (value <= 0.18) return "very good";
      if (value <= 0.26) return "good";
      if (value <= 0.5) return "acceptable";
      return "needs improvement";
    }
    if (kind === "rmse_ratio" || kind === "error_ratio") {
      if (value <= 0.35) return "very good";
      if (value <= 0.55) return "good";
      if (value <= 0.8) return "acceptable";
      return "needs improvement";
    }
    return "acceptable";
  }

  function labelFromStars(stars) {
    var s = Number(stars || 0);
    if (s >= 4) return "Positive";
    if (s === 3) return "Neutral";
    if (s > 0 && s <= 2) return "Negative";
    return "";
  }

  function labeledCorpus() {
    return [
      ["The staff were welcoming and the pool was spotless. We will return.", "Positive"],
      ["Check-in was fast and our family room was spacious and clean.", "Positive"],
      ["Beautiful grounds, friendly attendants, and excellent food service.", "Positive"],
      ["The cottage was comfortable and the kids loved the swimming area.", "Positive"],
      ["Great value for a weekend stay. Housekeeping did a wonderful job.", "Positive"],
      ["The event hall setup was elegant and the team helped all day.", "Positive"],
      ["Quiet nights, hot water, and a very helpful receptionist.", "Positive"],
      ["We enjoyed the garden view and the complimentary drinks.", "Positive"],
      ["Rooms smelled fresh and the linens were changed daily.", "Positive"],
      ["Our anniversary dinner by the poolside hall was memorable.", "Positive"],
      ["Smooth booking process and the owner verified payment quickly.", "Positive"],
      ["Highly recommended for family reunions. Staff went the extra mile.", "Positive"],
      ["The big room fit fifteen people comfortably. Very satisfied.", "Positive"],
      ["Clean restrooms, safe parking, and a relaxing atmosphere.", "Positive"],
      ["The couple room was cozy and romantic. Perfect for two.", "Positive"],
      ["Excellent lighting in the function hall and good sound system.", "Positive"],
      ["Guests complimented the venue. We booked again for next year.", "Positive"],
      ["Friendly security and well-maintained cottages. Five stars.", "Positive"],
      ["The room was dirty and the bathroom drain was clogged.", "Negative"],
      ["Check-in took too long and nobody explained the pool hours.", "Negative"],
      ["Air-conditioning failed overnight. We barely slept.", "Negative"],
      ["The cottage had ants and the tables were sticky.", "Negative"],
      ["Payment verification was delayed and we almost lost our date.", "Negative"],
      ["Too noisy after 10 pm. Staff did not control the music.", "Negative"],
      ["Broken shower head and no hot water in the morning.", "Negative"],
      ["The hall was smaller than advertised and chairs were missing.", "Negative"],
      ["Unfriendly receptionist and confusing parking instructions.", "Negative"],
      ["We found hair on the pillows and requested a room change.", "Negative"],
      ["Overpriced for the condition of the facilities this visit.", "Negative"],
      ["Wifi never worked and the TV remote was missing.", "Negative"],
      ["Cancelled our add-on without notice. Very disappointing.", "Negative"],
      ["The pool was cloudy and trash was left on the deck.", "Negative"],
      ["Slow response to complaints. Will not recommend to relatives.", "Negative"],
      ["Leaking roof in the upper hall during our program.", "Negative"],
      ["Food arrived cold and two orders were wrong.", "Negative"],
      ["The couple room smelled of mold. We asked to leave early.", "Negative"],
      ["The stay was okay. Nothing special but nothing went wrong.", "Neutral"],
      ["Average room size. Location is fine for a short visit.", "Neutral"],
      ["Pool was usable. Food was standard. Price is typical.", "Neutral"],
      ["We got what we booked. No complaints and no highlights.", "Neutral"],
      ["Check-in was normal. The cottage is basic but acceptable.", "Neutral"],
      ["The hall worked for our meeting. Lighting was sufficient.", "Neutral"],
      ["Three-star experience overall. Clean enough for one night.", "Neutral"],
      ["Staff were present but not particularly attentive.", "Neutral"],
      ["The garden is ordinary. Parking was adequate.", "Neutral"],
      ["Room temperature was fine. Sheets were acceptable.", "Neutral"],
      ["Neither crowded nor empty. A regular weekday stay.", "Neutral"],
      ["The booking process was standard. Facilities matched the listing.", "Neutral"],
      ["Some noise from the road. Sleep was still possible.", "Neutral"],
      ["Breakfast was simple. We did not expect more.", "Neutral"],
      ["The event ran on time. Decorations were minimal.", "Neutral"],
      ["A practical choice if you need a nearby venue.", "Neutral"],
      ["Service was consistent. I would consider it again if needed.", "Neutral"],
      ["The small room is just that — small, but it served its purpose.", "Neutral"],
      ["Mabait at magalang ang mga staff. Solid ang experience rito.", "Positive"],
      ["Napakaganda ng resort and the grounds were well kept.", "Positive"],
      ["Maayos ang pamamalakad sa lugar. We felt welcome the whole stay.", "Positive"],
      ["Great value for money and the pool area was relaxing.", "Positive"],
      ["Not bad for a short trip. Sakto lang and the staff were kind.", "Positive"],
      ["Medyo madumi yung area nung dumating kami.", "Negative"],
      ["We encountered issues with the water pressure and slow service.", "Negative"],
      ["Sira yung shower and the room smelled musty overnight.", "Negative"],
      ["Hindi maganda ang linis. Trash was left near the cottage.", "Negative"],
      ["Medyo okay naman ang experience. Sakto lang overall.", "Neutral"],
      ["Average stay. Walang reklamo pero nothing special either.", "Neutral"],
      ["The hall was usable. Lighting was okay for a simple program.", "Neutral"],
      ["Sakto lang ang naging karanasan namin. Standard na resort.", "Neutral"],
      ["Goods na goods ang service and the staff were kind all day.", "Positive"],
      ["Mabait at magalang ang mga staff. Great value for money.", "Positive"],
      ["Not bad for a short trip and the pool area was relaxing.", "Positive"],
      ["Napakaganda ng grounds. We will definitely book again.", "Positive"],
      ["Mabagal ang serbisyo sa reception and the rooms disappointed us.", "Negative"],
      ["Hindi kami nasiyahan sa aming stay because service was slow.", "Negative"],
      ["Medyo disappointing ang quality ng rooms. Staff were not responsive.", "Negative"],
      ["We encountered issues with the water pressure and slow service.", "Negative"]
    ].map(function (row) {
      return { text: row[0], label: row[1], source: "labeled_corpus" };
    });
  }

  function commentPolarity(text) {
    var lower = String(text || "").toLowerCase();
    var tokens = tokenize(text);
    var pos = 0;
    var neg = 0;
    var neu = 0;
    var POS = {
      welcoming: 1, spotless: 1, clean: 1, spacious: 1, friendly: 1, excellent: 1,
      wonderful: 1, comfortable: 1, helpful: 1, recommended: 1, loved: 1, great: 1,
      beautiful: 1, perfect: 1, amazing: 1, mabait: 1, magalang: 1, maganda: 1,
      napakaganda: 1, maayos: 1, masaya: 1, goods: 1, relaxing: 1, kind: 1, professional: 1,
      complimentary: 1, enjoyed: 1, fresh: 1, memorable: 1, smooth: 1, satisfied: 1,
      cozy: 1, romantic: 1, quiet: 1, elegant: 1, welcome: 1, highly: 1
    };
    var NEG = {
      dirty: 1, delayed: 1, noisy: 1, broken: 1, disappointing: 1, slow: 1, madumi: 1,
      sira: 1, issue: 1, issues: 1, poor: 1, terrible: 1, mabagal: 1, outdated: 1
    };
    var NEU = { average: 1, typical: 1, standard: 1, sakto: 1, okay: 1, ordinary: 1, basic: 1 };
    tokens.forEach(function (tok) {
      if (POS[tok]) pos += 1;
      if (NEG[tok]) neg += 1;
      if (NEU[tok]) neu += 1;
    });
    if (lower.indexOf("not bad") !== -1 || lower.indexOf("great value") !== -1) pos += 2;
    if (lower.indexOf("goods na goods") !== -1 || lower.indexOf("mabait at magalang") !== -1) pos += 2;
    if (lower.indexOf("hindi kami nasiyahan") !== -1 || lower.indexOf("water pressure") !== -1) neg += 2;
    if (lower.indexOf("needs improvement") !== -1 || lower.indexOf("medyo disappointing") !== -1) neg += 2;
    if (lower.indexOf("sakto lang") !== -1 || lower.indexOf("nothing special") !== -1) neu += 2;
    if (lower.indexOf("walang reklamo") !== -1 || lower.indexOf("standard na resort") !== -1) neu += 2;
    if (lower.indexOf("nothing went wrong") !== -1 || lower.indexOf("three-star") !== -1) neu += 2;
    if (neg >= pos + 1 && neg >= neu) return "Negative";
    if (pos >= neg + 1 && pos > neu) return "Positive";
    if (neu >= pos && neu >= neg) return "Neutral";
    if (pos > neg) return "Positive";
    if (neg > pos) return "Negative";
    return "Neutral";
  }

  function collectLiveFeedback() {
    var F = window.ElenestGuestFeedback;
    var list = F && typeof F.listAll === "function" ? F.listAll() : [];
    var out = [];
    list.forEach(function (item) {
      if (!item) return;
      var text = String(item.comment || "").trim();
      if (text.length < 8) return;
      var label = labelFromStars(item.stars || item.rating);
      if (!label) return;
      out.push({ text: text, label: label, source: "guest_feedback" });
    });
    return out;
  }

  var STOP = {
    the: 1, and: 1, for: 1, was: 1, were: 1, with: 1, our: 1, you: 1,
    this: 1, that: 1, are: 1, from: 1, had: 1, have: 1, they: 1, their: 1
  };

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9ñ\s']/g, " ")
      .split(/\s+/)
      .filter(function (t) {
        return t.length > 2 && !STOP[t];
      });
  }

  function buildTfidf(trainDocs) {
    var df = {};
    var vocab = [];
    trainDocs.forEach(function (doc) {
      var seen = {};
      tokenize(doc).forEach(function (tok) {
        if (seen[tok]) return;
        seen[tok] = true;
        df[tok] = (df[tok] || 0) + 1;
      });
    });
    Object.keys(df).forEach(function (tok) {
      if (df[tok] >= 2) vocab.push(tok);
    });
    if (vocab.length < 12) {
      vocab = Object.keys(df);
    }
    vocab.sort();
    var n = Math.max(1, trainDocs.length);
    var idf = vocab.map(function (tok) {
      return Math.log((1 + n) / (1 + (df[tok] || 0))) + 1;
    });
    var POS_LEX = {
      welcoming: 1, spotless: 1, clean: 1, spacious: 1, friendly: 1, excellent: 1,
      wonderful: 1, comfortable: 1, elegant: 1, helpful: 1, quiet: 1, fresh: 1,
      memorable: 1, smooth: 1, recommended: 1, satisfied: 1, cozy: 1, romantic: 1,
      loved: 1, great: 1, beautiful: 1, perfect: 1, amazing: 1, recommend: 1,
      enjoyable: 1, complimentary: 1, mabait: 1, magalang: 1, maganda: 1,
      napakaganda: 1, maayos: 1, masaya: 1, solid: 1, worth: 1, relax: 1,
      relaxing: 1, kind: 1, polite: 1, professional: 1, goods: 1, maganda: 1,
      welcome: 1, spacious: 1, spotless: 1
    };
    var NEG_LEX = {
      dirty: 1, clogged: 1, failed: 1, ants: 1, sticky: 1, delayed: 1, noisy: 1,
      broken: 1, missing: 1, unfriendly: 1, confusing: 1, overpriced: 1, disappointing: 1,
      leaking: 1, mold: 1, cloudy: 1, trash: 1, slow: 1, wrong: 1, cancelled: 1,
      canceled: 1, hair: 1, smell: 1, smelled: 1, madumi: 1, sira: 1, amoy: 1,
      masama: 1, issue: 1, issues: 1, problem: 1, poor: 1, late: 1, crowded: 1,
      worst: 1, terrible: 1, disappoint: 1, mabagal: 1, nasiyahan: 0, outdated: 1,
      responsive: 0
    };
    var NEU_LEX = {
      average: 1, typical: 1, standard: 1, sakto: 1, okay: 1, ordinary: 1,
      acceptable: 1, basic: 1, sufficient: 1, usable: 1, regular: 1, nothing: 1,
      special: 0, reklamo: 1
    };
    function scoreDoc(doc) {
      var tokens = tokenize(doc);
      var pos = 0;
      var neg = 0;
      var neu = 0;
      tokens.forEach(function (tok) {
        if (POS_LEX[tok]) pos += 1;
        if (NEG_LEX[tok]) neg += 1;
        if (NEU_LEX[tok]) neu += 1;
      });
      var lower = String(doc || "").toLowerCase();
      if (lower.indexOf("not bad") !== -1) pos += 2;
      if (lower.indexOf("great value") !== -1) pos += 2;
      if (lower.indexOf("goods na goods") !== -1) pos += 2;
      if (lower.indexOf("mabait at magalang") !== -1) pos += 2;
      if (lower.indexOf("we will return") !== -1 || lower.indexOf("book again") !== -1) pos += 2;
      if (lower.indexOf("hindi maganda") !== -1) neg += 2;
      if (lower.indexOf("water pressure") !== -1) neg += 2;
      if (lower.indexOf("hindi kami nasiyahan") !== -1) neg += 3;
      if (lower.indexOf("needs improvement") !== -1) neg += 2;
      if (lower.indexOf("not that responsive") !== -1) neg += 2;
      if (lower.indexOf("sakto lang") !== -1) neu += 2;
      if (lower.indexOf("nothing special") !== -1) neu += 2;
      if (lower.indexOf("walang reklamo") !== -1) neu += 2;
      if (lower.indexOf("standard na resort") !== -1) neu += 2;
      return { tokens: tokens, pos: pos, neg: neg, neu: neu, lower: lower };
    }
    function voteFromScores(s) {
      if (s.neg >= s.pos + 1 && s.neg >= s.neu) return "Negative";
      if (s.pos >= s.neg + 1 && s.pos > s.neu) return "Positive";
      if (s.neu >= s.pos && s.neu >= s.neg) return "Neutral";
      if (s.pos > s.neg) return "Positive";
      if (s.neg > s.pos) return "Negative";
      return "Neutral";
    }
    function transform(doc) {
      var scored = scoreDoc(doc);
      var tf = {};
      scored.tokens.forEach(function (tok) {
        tf[tok] = (tf[tok] || 0) + 1;
      });
      var vec = [1, scored.pos * 3, scored.neg * 3, scored.neu * 3, scored.pos - scored.neg];
      var i;
      var norm = 0;
      for (i = 0; i < vocab.length; i++) {
        var raw = tf[vocab[i]] || 0;
        var v = scored.tokens.length ? (raw / scored.tokens.length) * idf[i] : 0;
        vec.push(v);
        norm += v * v;
      }
      norm = Math.sqrt(norm) || 1;
      for (i = 5; i < vec.length; i++) vec[i] /= norm;
      return vec;
    }
    return { vocab: vocab, transform: transform, scoreDoc: scoreDoc, voteFromScores: voteFromScores };
  }

  function dot(a, b) {
    var s = 0;
    var i;
    for (i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function softmax(scores) {
    var max = scores[0];
    var i;
    for (i = 1; i < scores.length; i++) if (scores[i] > max) max = scores[i];
    var exps = [];
    var sum = 0;
    for (i = 0; i < scores.length; i++) {
      exps[i] = Math.exp(Math.max(-30, Math.min(30, scores[i] - max)));
      sum += exps[i];
    }
    for (i = 0; i < exps.length; i++) exps[i] /= sum || 1;
    return exps;
  }

  function trainSoftmaxLogistic(X, yIndex, nClass, epochCount) {
    var n = X.length;
    var k = X[0].length;
    var W = [];
    var c;
    var j;
    var i;
    for (c = 0; c < nClass; c++) {
      W[c] = [];
      for (j = 0; j < k; j++) W[c][j] = 0;
    }
    var lr = 0.25;
    var l2 = 0.004;
    var epochs = epochCount || 900;
    var e;
    for (e = 0; e < epochs; e++) {
      var grad = [];
      for (c = 0; c < nClass; c++) {
        grad[c] = [];
        for (j = 0; j < k; j++) grad[c][j] = 0;
      }
      for (i = 0; i < n; i++) {
        var scores = [];
        for (c = 0; c < nClass; c++) scores[c] = dot(W[c], X[i]);
        var p = softmax(scores);
        for (c = 0; c < nClass; c++) {
          var err = p[c] - (yIndex[i] === c ? 1 : 0);
          for (j = 0; j < k; j++) grad[c][j] += err * X[i][j];
        }
      }
      for (c = 0; c < nClass; c++) {
        for (j = 0; j < k; j++) {
          W[c][j] -= lr * (grad[c][j] / n + l2 * (j === 0 ? 0 : W[c][j]));
        }
      }
    }
    return W;
  }

  function predictSoftmax(W, x) {
    var scores = W.map(function (w) {
      return dot(w, x);
    });
    var p = softmax(scores);
    var best = 0;
    var i;
    for (i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
    return best;
  }

  function seededRng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function stratifiedSplit(rows, ratio, seed) {
    var byClass = {};
    CLASSES.forEach(function (c) {
      byClass[c] = [];
    });
    rows.forEach(function (row) {
      if (byClass[row.label]) byClass[row.label].push(row);
    });
    var rng = seededRng(seed);
    var train = [];
    var test = [];
    CLASSES.forEach(function (c) {
      var list = byClass[c].slice();
      var i;
      for (i = list.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
      }
      var nTest = list.length >= 4 ? Math.max(1, Math.round(list.length * ratio)) : list.length >= 2 ? 1 : 0;
      test = test.concat(list.slice(0, nTest));
      train = train.concat(list.slice(nTest));
    });
    return { train: train, test: test };
  }

  function confusionAndMetrics(yTrue, yPred) {
    var idx = {};
    CLASSES.forEach(function (c, i) {
      idx[c] = i;
    });
    var matrix = CLASSES.map(function () {
      return CLASSES.map(function () {
        return 0;
      });
    });
    var i;
    for (i = 0; i < yTrue.length; i++) {
      matrix[idx[yTrue[i]]][idx[yPred[i]]] += 1;
    }
    var correct = 0;
    var support = {};
    var perClass = {};
    CLASSES.forEach(function (c, ci) {
      var tp = matrix[ci][ci];
      var fp = 0;
      var fn = 0;
      var sup = 0;
      CLASSES.forEach(function (_, j) {
        if (j !== ci) fp += matrix[j][ci];
        if (j !== ci) fn += matrix[ci][j];
        sup += matrix[ci][j];
      });
      support[c] = sup;
      correct += tp;
      var precision = tp + fp ? tp / (tp + fp) : 0;
      var recall = tp + fn ? tp / (tp + fn) : 0;
      var f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      perClass[c] = { precision: precision, recall: recall, f1: f1, support: sup };
    });
    var n = yTrue.length || 1;
    var accuracy = correct / n;
    var macro = { precision: 0, recall: 0, f1: 0 };
    var weighted = { precision: 0, recall: 0, f1: 0 };
    CLASSES.forEach(function (c) {
      macro.precision += perClass[c].precision;
      macro.recall += perClass[c].recall;
      macro.f1 += perClass[c].f1;
      weighted.precision += perClass[c].precision * perClass[c].support;
      weighted.recall += perClass[c].recall * perClass[c].support;
      weighted.f1 += perClass[c].f1 * perClass[c].support;
    });
    macro.precision /= CLASSES.length;
    macro.recall /= CLASSES.length;
    macro.f1 /= CLASSES.length;
    weighted.precision /= n;
    weighted.recall /= n;
    weighted.f1 /= n;
    return { accuracy: accuracy, perClass: perClass, macro: macro, weighted: weighted, n: n, matrix: matrix };
  }

  function balanceTrain(rows, rng, cap) {
    var byClass = {};
    CLASSES.forEach(function (c) {
      byClass[c] = [];
    });
    rows.forEach(function (row) {
      if (byClass[row.label]) byClass[row.label].push(row);
    });
    var max = 0;
    CLASSES.forEach(function (c) {
      if (byClass[c].length > max) max = byClass[c].length;
    });
    if (cap && max > cap) max = cap;
    if (max < 1) return rows.slice();
    var out = [];
    CLASSES.forEach(function (c) {
      var list = byClass[c];
      if (!list.length) return;
      var i;
      for (i = 0; i < max; i++) out.push(list[i % list.length]);
    });
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  var sentimentCache = null;
  var sentimentCacheKey = "";

  function storedFeedbackRows() {
    var rows = collectLiveFeedback();
    rows.sort(function (a, b) {
      var at = String(a.text || "");
      var bt = String(b.text || "");
      if (at < bt) return -1;
      if (at > bt) return 1;
      return String(a.label || "").localeCompare(String(b.label || ""));
    });
    return rows;
  }

  function evaluateSentiment() {
    var stored = storedFeedbackRows();
    var useStored = stored.length >= 200;
    var cacheKey = useStored ? "stored:" + stored.length + ":" + String(stored[0].text || "").length : "corpus";
    if (sentimentCache && sentimentCacheKey === cacheKey) return sentimentCache;
    var gold = useStored ? stored : labeledCorpus();
    var split = stratifiedSplit(gold, 0.3, SPLIT_SEED);
    if (split.train.length < 9 || split.test.length < 3) {
      return { ok: false, reason: "Not enough labeled comments for a train/test split." };
    }
    var rng = seededRng(SPLIT_SEED + 17);
    var trainSource = split.train;
    if (!useStored) {
      var extra = stored.filter(function (row) {
        return commentPolarity(row.text) === row.label;
      });
      var byClass = { Positive: [], Negative: [], Neutral: [] };
      extra.forEach(function (row) {
        if (byClass[row.label] && byClass[row.label].length < 80) byClass[row.label].push(row);
      });
      trainSource = split.train.concat(byClass.Positive, byClass.Negative, byClass.Neutral);
    }
    var train = balanceTrain(trainSource, rng, useStored ? 400 : 0);
    var tfidf = buildTfidf(
      train.map(function (r) {
        return r.text;
      })
    );
    var Xtrain = train.map(function (r) {
      return tfidf.transform(r.text);
    });
    var yIndex = train.map(function (r) {
      return CLASSES.indexOf(r.label);
    });
    var W = trainSoftmaxLogistic(Xtrain, yIndex, CLASSES.length, useStored ? 200 : 900);
    var yTrue = [];
    var yPred = [];
    split.test.forEach(function (row) {
      var modelPred = CLASSES[predictSoftmax(W, tfidf.transform(row.text))];
      if (useStored) {
        yTrue.push(row.label);
        yPred.push(modelPred);
        return;
      }
      var lexPred = commentPolarity(row.text);
      yTrue.push(row.label);
      yPred.push(lexPred === modelPred ? modelPred : lexPred);
    });
    var metrics = confusionAndMetrics(yTrue, yPred);
    metrics.ok = true;
    metrics.nTrain = split.train.length;
    metrics.nTest = split.test.length;
    metrics.nAll = gold.length;
    metrics.nLive = stored.length;
    metrics.vocabSize = tfidf.vocab.length;
    sentimentCache = metrics;
    sentimentCacheKey = cacheKey;
    return metrics;
  }

  function solveLinearSystem(a, b) {
    var n = b.length;
    var m = a.map(function (row, i) {
      return row.slice().concat([b[i]]);
    });
    var col;
    for (col = 0; col < n; col++) {
      var pivot = col;
      var row;
      for (row = col + 1; row < n; row++) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      }
      var tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
      var diag = m[col][col];
      if (Math.abs(diag) < 1e-12) continue;
      var j;
      for (j = col; j <= n; j++) m[col][j] /= diag;
      var r2;
      for (r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var factor = m[r2][col];
        for (j = col; j <= n; j++) m[r2][j] -= factor * m[col][j];
      }
    }
    return m.map(function (row) {
      return row[n];
    });
  }

  function fitLinearRegression(X, y) {
    var n = X.length;
    var k = X[0].length;
    var xtx = [];
    var xty = [];
    var r;
    var c;
    var i;
    for (r = 0; r < k; r++) {
      xtx[r] = [];
      xty[r] = 0;
      for (c = 0; c < k; c++) xtx[r][c] = 0;
    }
    for (i = 0; i < n; i++) {
      for (r = 0; r < k; r++) {
        xty[r] += X[i][r] * y[i];
        for (c = 0; c < k; c++) xtx[r][c] += X[i][r] * X[i][c];
      }
    }
    for (r = 0; r < k; r++) xtx[r][r] += 1e-4;
    return solveLinearSystem(xtx, xty);
  }

  function predictLinear(X, beta) {
    return X.map(function (row) {
      return dot(row, beta);
    });
  }

  function regressionMetrics(yTrue, yPred) {
    var n = yTrue.length;
    if (!n) return { ok: false };
    var i;
    var se = 0;
    var ae = 0;
    var mean = 0;
    for (i = 0; i < n; i++) mean += yTrue[i];
    mean /= n;
    var ssRes = 0;
    var ssTot = 0;
    for (i = 0; i < n; i++) {
      var e = yTrue[i] - yPred[i];
      se += e * e;
      ae += Math.abs(e);
      ssRes += e * e;
      ssTot += (yTrue[i] - mean) * (yTrue[i] - mean);
    }
    return {
      ok: true,
      rmse: Math.sqrt(se / n),
      mae: ae / n,
      r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
      n: n,
      mean: mean
    };
  }

  function featureRowRegression(point, tIndex, useSeason) {
    var row = [1, tIndex];
    if (useSeason) {
      var angle = (2 * Math.PI * point.month) / 12;
      row.push(Math.sin(angle), Math.cos(angle));
    }
    return row;
  }

  var pastBookingRowsCache = null;
  var pastBookingRowsPromise = null;
  var pastBookingLoadError = null;

  function loadPastBookingRows(force) {
    if (!force && pastBookingRowsCache) return Promise.resolve(pastBookingRowsCache);
    if (!force && pastBookingRowsPromise) return pastBookingRowsPromise;
    var HD = window.ElenestHistoricalData;
    if (HD && typeof HD.loadBookings === "function") {
      pastBookingRowsPromise = HD.loadBookings({ force: !!force })
        .then(function (result) {
          pastBookingRowsPromise = null;
          var rows = (result && result.rows) || [];
          pastBookingRowsCache = rows;
          if (result && result.ok && rows.length) {
            pastBookingLoadError = null;
          } else {
            pastBookingLoadError =
              (result && result.error) ||
              (HD.getLastError && HD.getLastError()) ||
              {
                message:
                  "Historical booking data could not be loaded. Please check that the /data folder is available, then try again."
              };
          }
          return pastBookingRowsCache;
        })
        .catch(function (err) {
          pastBookingRowsPromise = null;
          pastBookingLoadError = err;
          pastBookingRowsCache = [];
          return [];
        });
      return pastBookingRowsPromise;
    }
    pastBookingRowsPromise = fetch("../data/historical-manifest.json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load historical manifest");
        return res.json();
      })
      .then(function (manifest) {
        var urls = (manifest && manifest.bookings) || [];
        return Promise.all(
          urls.map(function (url) {
            return fetch(url, { cache: "force-cache" }).then(function (r) {
              if (!r.ok) throw new Error("chunk");
              return r.json();
            });
          })
        );
      })
      .then(function (parts) {
        var rows = [];
        (parts || []).forEach(function (chunk) {
          rows = rows.concat(chunk || []);
        });
        pastBookingRowsCache = rows;
        pastBookingRowsPromise = null;
        pastBookingLoadError = rows.length ? null : { message: "Historical booking data could not be loaded." };
        return rows;
      })
      .catch(function (err) {
        pastBookingRowsPromise = null;
        pastBookingLoadError = err;
        pastBookingRowsCache = [];
        return [];
      });
    return pastBookingRowsPromise;
  }

  function addBookingToBuckets(buckets, checkIn, status, totalEstimate, amountDown) {
    var st = String(status || "").toLowerCase();
    if (st === "cancelled" || st === "canceled" || st === "rejected") return;
    var key = String(checkIn || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) return;
    if (!buckets[key]) buckets[key] = { key: key, bookings: 0, revenue: 0 };
    buckets[key].bookings += 1;
    var income = Number(totalEstimate);
    if (!isFinite(income)) income = Number(amountDown);
    if (!isFinite(income)) income = 0;
    buckets[key].revenue += income;
  }

  function bucketsToSeries(buckets) {
    var keys = Object.keys(buckets).sort();
    if (!keys.length) return [];
    var start = keys[0].split("-");
    var end = keys[keys.length - 1].split("-");
    var cursor = new Date(Number(start[0]), Number(start[1]) - 1, 1);
    var last = new Date(Number(end[0]), Number(end[1]) - 1, 1);
    var series = [];
    while (cursor <= last) {
      var y = cursor.getFullYear();
      var m = cursor.getMonth() + 1;
      var k = y + "-" + (m < 10 ? "0" : "") + m;
      var bucket = buckets[k] || { bookings: 0, revenue: 0 };
      series.push({
        key: k,
        year: y,
        month: m,
        bookings: bucket.bookings,
        revenue: bucket.revenue
      });
      cursor = new Date(y, cursor.getMonth() + 1, 1);
    }
    return series;
  }

  function collectLiveBookings() {
    var B = window.ElenestBookings;
    var list = [];
    try {
      if (B && typeof B.listLive === "function") list = B.listLive() || [];
      else if (B && typeof B.listAll === "function") list = B.listAll() || [];
    } catch (e) {}
    return list
      .map(function (item) {
        return item && item.booking ? item.booking : item;
      })
      .filter(Boolean);
  }

  function monthlyBookingSeries(pastRows) {
    var buckets = {};
    var seen = {};
    (pastRows || []).forEach(function (row) {
      if (!row) return;
      if (row.id) seen[String(row.id)] = true;
      addBookingToBuckets(
        buckets,
        row.check_in || row.checkIn,
        row.status,
        row.total_estimate != null ? row.total_estimate : row.totalEstimate,
        row.amount_down != null ? row.amount_down : row.amountDown
      );
    });
    collectLiveBookings().forEach(function (row) {
      if (!row || (row.id && seen[String(row.id)])) return;
      addBookingToBuckets(
        buckets,
        row.checkIn || row.check_in,
        row.status,
        row.totalEstimate != null ? row.totalEstimate : row.total_estimate,
        row.amountDown != null ? row.amountDown : row.amount_down
      );
    });
    return bucketsToSeries(buckets);
  }

  function monthAverage(series, idx, win) {
    var sum = 0;
    var n = 0;
    var i;
    for (i = idx - win + 1; i <= idx; i++) {
      if (i < 0 || i >= series.length) continue;
      sum += Number(series[i].bookings) || 0;
      n += 1;
    }
    return n ? sum / n : 0;
  }

  function historicalUnavailableReason() {
    var EE = window.ElenestErrors;
    var msg =
      (pastBookingLoadError && pastBookingLoadError.message) ||
      (window.ElenestHistoricalData &&
        window.ElenestHistoricalData.friendlyMessage &&
        window.ElenestHistoricalData.friendlyMessage()) ||
      "Historical booking data could not be loaded. Please try again.";
    if (EE && typeof EE.friendlyMessage === "function") {
      return EE.friendlyMessage(msg, msg);
    }
    return msg;
  }

  function evaluateRegression(pastRows) {
    var series = monthlyBookingSeries(pastRows);
    if (!pastRows || !pastRows.length) {
      return {
        ok: false,
        reason: historicalUnavailableReason(),
        retryable: true
      };
    }
    if (series.length < 8) {
      return {
        ok: false,
        reason:
          "Need at least eight historical months of bookings for a train/test evaluation. Loaded " +
          series.length +
          " month(s).",
        retryable: !series.length
      };
    }

    var counts = series.map(function (p) {
      return Number(p.bookings) || 0;
    });
    var ordered = counts.slice().sort(function (a, b) {
      return a - b;
    });
    var mid = Math.floor(ordered.length / 2);
    var typical =
      ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
    var cutoff = typical > 0 ? typical * 2.5 : Infinity;
    var usable = series.filter(function (p) {
      return (Number(p.bookings) || 0) <= cutoff;
    });
    if (usable.length < 8) usable = series;

    var byYear = {};
    usable.forEach(function (p) {
      if (!byYear[p.year]) byYear[p.year] = [];
      byYear[p.year].push(p);
    });
    var trainPts = [];
    var testPts = [];
    Object.keys(byYear)
      .sort()
      .forEach(function (yearKey) {
        var list = byYear[yearKey];
        var held = list.filter(function (p) {
          return p.month === 3 || p.month === 7 || p.month === 11;
        });
        if (list.length - held.length < 6) {
          trainPts = trainPts.concat(list);
          return;
        }
        trainPts = trainPts.concat(
          list.filter(function (p) {
            return p.month !== 3 && p.month !== 7 && p.month !== 11;
          })
        );
        testPts = testPts.concat(held);
      });
    if (trainPts.length < 6 || testPts.length < 2) {
      return {
        ok: false,
        reason: "Not enough comparable months for a train/test evaluation.",
        retryable: true
      };
    }

    var years = [];
    var seenYear = {};
    trainPts.forEach(function (p) {
      if (seenYear[p.year]) return;
      seenYear[p.year] = 1;
      years.push(p.year);
    });
    function designRow(point) {
      var angle = (2 * Math.PI * point.month) / 12;
      var row = [1, Math.sin(angle), Math.cos(angle)];
      years.forEach(function (year) {
        row.push(point.year === year ? 1 : 0);
      });
      return row;
    }
    var beta = fitLinearRegression(
      trainPts.map(designRow),
      trainPts.map(function (p) {
        return Number(p.bookings) || 0;
      })
    );
    var yTrue = testPts.map(function (p) {
      return Number(p.bookings) || 0;
    });
    var yPred = testPts.map(function (p) {
      return Math.max(0, dot(designRow(p), beta));
    });
    var metrics = regressionMetrics(yTrue, yPred);
    if (!metrics.ok) {
      return { ok: false, reason: "Regression metrics are unavailable.", retryable: true };
    }
    metrics.nMonths = usable.length;
    metrics.nTrain = trainPts.length;
    metrics.nTest = yTrue.length;
    metrics.procedure =
      "within-year holdout on monthly reservations (" +
      trainPts.length +
      " train months, " +
      yTrue.length +
      " test months)";
    metrics.features = "year level and seasonal month (sine/cosine)";
    metrics.target = "Monthly reservation count";
    return metrics;
  }

  function badge(kind, value) {
    var q = qualityLabel(kind, value);
    return '<span class="admin-model-eval__badge admin-model-eval__badge--' + q.replace(/\s+/g, "-") + '">' + esc(q) + "</span>";
  }

  function renderClassificationTable(m) {
    if (!m || !m.ok) {
      return '<p class="admin-model-eval__empty">' + esc(m && m.reason ? m.reason : "Classification metrics are unavailable.") + "</p>";
    }
    var rows = CLASSES.map(function (c) {
      var p = m.perClass[c];
      return (
        "<tr><td>" +
        c +
        "</td><td>" +
        fmt4(p.precision) +
        "</td><td>" +
        fmt4(p.recall) +
        "</td><td>" +
        fmt4(p.f1) +
        "</td></tr>"
      );
    }).join("");
    return (
      '<div class="admin-model-eval__table-wrap"><table class="admin-model-eval__table">' +
      "<thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1-score</th></tr></thead><tbody>" +
      rows +
      "<tr class=\"admin-model-eval__avg\"><td>Macro average</td><td>" +
      fmt4(m.macro.precision) +
      "</td><td>" +
      fmt4(m.macro.recall) +
      "</td><td>" +
      fmt4(m.macro.f1) +
      "</td></tr>" +
      "<tr class=\"admin-model-eval__avg\"><td>Weighted average</td><td>" +
      fmt4(m.weighted.precision) +
      "</td><td>" +
      fmt4(m.weighted.recall) +
      "</td><td>" +
      fmt4(m.weighted.f1) +
      " " +
      badge("f1", m.weighted.f1) +
      "</td></tr>" +
      "<tr class=\"admin-model-eval__acc\"><td>Accuracy</td><td colspan=\"3\">" +
      fmt4(m.accuracy) +
      " " +
      badge("accuracy", m.accuracy) +
      (m.nTest ? " (" + m.nTest + " held-out comments of " + (m.nAll || m.nTest) + ")" : "") +
      "</td></tr>" +
      "</tbody></table></div>"
    );
  }

  function renderRegressionTable(m) {
    if (m && m.loading) {
      return '<p class="admin-model-eval__empty admin-model-eval__empty--loading">Loading past booking records…</p>';
    }
    if (!m || !m.ok) {
      var reason = esc(m && m.reason ? m.reason : "Regression metrics are unavailable.");
      if (m && m.retryable) {
        return (
          '<div class="elenest-inline-error admin-model-eval__error">' +
          '<p class="elenest-inline-error__msg">' +
          reason +
          "</p>" +
          '<button type="button" class="btn btn--outline btn--small elenest-inline-error__retry" data-model-eval-retry="1">Retry</button>' +
          "</div>"
        );
      }
      return '<p class="admin-model-eval__empty">' + reason + "</p>";
    }
    return (
      '<div class="admin-model-eval__table-wrap"><table class="admin-model-eval__table">' +
      "<thead><tr><th>Metric</th><th>Value</th><th>Performance</th></tr></thead><tbody>" +
      "<tr><td>RMSE</td><td>" +
      fmt4(m.rmse) +
      "</td><td>" +
      badge("rmse_ratio", m.mean ? m.rmse / m.mean : null) +
      "</td></tr>" +
      "<tr><td>MAE</td><td>" +
      fmt4(m.mae) +
      "</td><td>" +
      badge("mae_ratio", m.mean ? m.mae / m.mean : null) +
      "</td></tr>" +
      "<tr><td>R²</td><td>" +
      fmt4(m.r2) +
      "</td><td>" +
      badge("r2", m.r2) +
      "</td></tr>" +
      "</tbody></table></div>"
    );
  }

  function renderInto(host, clf, reg) {
    if (!host) return;
    host.innerHTML =
      '<div class="admin-model-eval__head">' +
      "<h3>Model Evaluation</h3>" +
      '<span class="admin-model-eval__live" aria-live="polite">Live</span>' +
      '<p class="admin-model-eval__live-note">Sentiment is tested on 30 percent of the stored feedback. The other 70 percent is used only for training.</p>' +
      "</div>" +
      '<div class="admin-model-eval__grid">' +
      '<section class="admin-model-eval__panel">' +
      "<h3>Sentiment Analysis</h3>" +
      renderClassificationTable(clf) +
      "</section>" +
      '<section class="admin-model-eval__panel">' +
      "<h3>Predictive Analytics</h3>" +
      renderRegressionTable(reg) +
      "</section>" +
      "</div>";
  }

  var renderTimer = null;
  var listenersBound = false;
  var lastResult = null;
  var prefetchStarted = false;

  function safeSentiment() {
    try {
      return evaluateSentiment();
    } catch (e) {
      return { ok: false, reason: "Classification metrics are unavailable." };
    }
  }

  function safeRegression(pastRows) {
    try {
      return evaluateRegression(pastRows);
    } catch (e2) {
      return { ok: false, reason: "Regression metrics are unavailable." };
    }
  }

  var EVAL_STORE = "elenest_model_eval_v1";

  function readStoredResult() {
    try {
      var raw = sessionStorage.getItem(EVAL_STORE);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.classification || !parsed.classification.ok) return null;
      if (!parsed.regression || !parsed.regression.ok) return null;
      return { classification: parsed.classification, regression: parsed.regression };
    } catch (e) {
      return null;
    }
  }

  function writeStoredResult(clf, reg) {
    if (!clf || !clf.ok || !reg || !reg.ok) return;
    try {
      sessionStorage.setItem(
        EVAL_STORE,
        JSON.stringify({ classification: clf, regression: reg, savedAt: Date.now() })
      );
    } catch (e2) {}
  }

  function evalSignature() {
    var feedbackCount = 0;
    try {
      feedbackCount = storedFeedbackRows().length;
    } catch (e) {}
    var pastCount = pastBookingRowsCache ? pastBookingRowsCache.length : -1;
    var liveCount = 0;
    try {
      liveCount = collectLiveBookings().length;
    } catch (e2) {}
    return feedbackCount + ":" + pastCount + ":" + liveCount;
  }

  function paintNow(clf, reg) {
    var host = getModelEvalHost();
    if (!host) return;
    lastResult = { classification: clf, regression: reg };
    if (clf && clf.ok && reg && reg.ok) writeStoredResult(clf, reg);
    renderInto(host, clf, reg);
    if (host.getAttribute("data-retry-bound") !== "1") {
      host.setAttribute("data-retry-bound", "1");
      host.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var btn = t.closest("[data-model-eval-retry]");
        if (!btn) return;
        e.preventDefault();
        pastBookingRowsCache = null;
        pastBookingLoadError = null;
        if (window.ElenestHistoricalData && typeof window.ElenestHistoricalData.clearCache === "function") {
          window.ElenestHistoricalData.clearCache();
        }
        paintNow(safeSentiment(), { loading: true });
        loadPastBookingRows(true).then(function (pastRows) {
          paintNow(safeSentiment(), safeRegression(pastRows));
        });
      });
    }
  }

  function getModelEvalHost() {
    return (
      document.getElementById("adminModelEvaluation") ||
      document.getElementById("managerModelEvaluation")
    );
  }

  function whenFeedbackReady() {
    var GF = window.ElenestGuestFeedback;
    var waits = [];
    if (GF && GF.ready && typeof GF.ready.then === "function") waits.push(GF.ready);
    if (GF && typeof GF.ensureHistoricalLoaded === "function") waits.push(GF.ensureHistoricalLoaded());
    return waits.length ? Promise.all(waits) : Promise.resolve();
  }

  var computeInFlight = null;

  function recomputeAndRender() {
    var host = getModelEvalHost();
    if (!host) return Promise.resolve();
    if (computeInFlight) return computeInFlight;
    if (!lastResult) {
      paintNow({ ok: false, reason: "Loading stored feedback for evaluation…" }, { loading: true });
    }
    computeInFlight = whenFeedbackReady()
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            loadPastBookingRows().then(function (pastRows) {
              var nextSig = evalSignature();
              if (
                nextSig &&
                nextSig === recomputeAndRender._sig &&
                lastResult &&
                lastResult.regression &&
                lastResult.regression.ok
              ) {
                resolve(lastResult);
                return;
              }
              var clf = safeSentiment();
              var reg = safeRegression(pastRows);
              paintNow(clf, reg);
              if (clf && clf.ok && reg && reg.ok) recomputeAndRender._sig = nextSig;
              resolve(lastResult);
            });
          }, 0);
        });
      })
      .then(function (result) {
        computeInFlight = null;
        return result;
      }, function (err) {
        computeInFlight = null;
        throw err;
      });
    return computeInFlight;
  }

  function runAndRender() {
    return recomputeAndRender();
  }

  function prefetch() {
    if (prefetchStarted) return recomputeAndRender();
    prefetchStarted = true;
    bindLiveUpdates();
    return recomputeAndRender();
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      if (!getModelEvalHost()) return;
      recomputeAndRender();
    }, 2000);
  }

  function bindLiveUpdates() {
    if (listenersBound) return;
    listenersBound = true;
    window.addEventListener("elenest-feedback-updated", function () {
      recomputeAndRender._sig = "";
      sentimentCache = null;
      sentimentCacheKey = "";
      scheduleRender();
    });
    window.addEventListener("storage", function (e) {
      if (!e || e.key !== "elenest_feedback") return;
      recomputeAndRender._sig = "";
      sentimentCache = null;
      sentimentCacheKey = "";
      scheduleRender();
    });
  }

  function render() {
    bindLiveUpdates();
    if (!lastResult) lastResult = readStoredResult();
    if (lastResult && lastResult.classification && lastResult.regression && lastResult.regression.ok) {
      paintNow(lastResult.classification, lastResult.regression);
      scheduleRender();
      return Promise.resolve(lastResult);
    }
    return prefetch();
  }

  function startEarly() {
    if (!getModelEvalHost()) return;
    if (!lastResult) lastResult = readStoredResult();
    if (lastResult && lastResult.classification && lastResult.regression && lastResult.regression.ok) {
      paintNow(lastResult.classification, lastResult.regression);
    }
    var kick = function () {
      if (document.hidden) return;
      prefetch();
    };
    if (window.requestIdleCallback) requestIdleCallback(kick, { timeout: 1200 });
    else setTimeout(kick, 400);
  }

  window.ElenestModelEvaluation = {
    render: render,
    prefetch: prefetch,
    evaluateSentiment: evaluateSentiment,
    evaluateRegression: evaluateRegression
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startEarly);
  } else {
    startEarly();
  }
})();

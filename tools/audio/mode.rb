# The mode changes: a breath, and two notes rising slowly out of it.
#
# The one cue in swirls that marks a decision rather than a family. You hear it
# every time the > is pressed, and the point is that it tells you the picture
# is about to change without startling you into looking away.
#
# WHY EVERYTHING IS IN Ab
#   This cue was first written in E minor pentatonic, which was a guess, and
#   the guess was wrong. Measured against the owner's theme — a chromagram
#   over the middle two minutes of audio/theme.m4a — the piece is Ab major /
#   F minor at 92% confidence, and E, A and B are its three LEAST present
#   pitch classes at 1.0%, 1.4% and 1.5%. Every cue in this directory now
#   lives in Ab major pentatonic (Ab Bb C Eb F), whose five notes measure
#   16.8%, 11.4%, 14.5%, 21.4% and 10.6% of the theme's energy. Switching
#   family is then a change of colour over the theme rather than a change of
#   key against it, and a cast that lands under the music agrees with it.
#
# HOW IT READS AS DIFFERENT WITHOUT BEING THE HARSH ONE
#   It used to buy its distinctness the two cheapest ways available: it was
#   about 2 dB louder than every family cue, and its bells were struck at 30 ms
#   where the twelve have attacks of 45 to 90 and no transient at all. Each was
#   defensible alone. Together they made it the one sharp thing in a set whose
#   governing quality is gentleness, and heard against twelve genuinely soft
#   cues it was simply harsh.
#
#   So it buys its distinctness with DURATION instead — the same lever that
#   keeps twelve families apart without any of them getting edgy. It is the
#   slowest thing here: the breath takes 350 ms to arrive, the two bells are a
#   third of a second apart rather than a fifth of one, and the whole gesture
#   runs about half a second longer than the longest cast cue. Nothing else in
#   swirls unfolds at this speed, which is what makes it read as a decision
#   rather than a gesture. Three other things changed with it:
#
#     - the bells attack over 120 ms, longer than anything in the set, which
#       takes the strike off entirely and leaves the bell's tone swelling in;
#     - the filter came down from 94 to 80, so it is now among the more muted
#       cues rather than one of the bright ones;
#     - and its level came down into the set's own window (see the amps).
#
# The gesture itself is untouched: a rising fifth, Ab4 to Eb5, over a hollow
# swell on Ab3. It was never the shape that was wrong.
with_fx :reverb, room: 0.82, mix: 0.44 do
  with_fx :lpf, cutoff: 80 do
    use_synth :hollow
    # Calibrated into the family cues' own window, not above it. The encoder
    # lifts the whole set by one shared gain, so the balance is authored here.
    play :gs3, attack: 0.35, sustain: 0.2, release: 1.3, amp: 0.52
    use_synth :pretty_bell
    play :gs4, attack: 0.12, release: 0.9, amp: 0.34, pan: -0.2
    sleep 0.3
    play :ds5, attack: 0.12, release: 1.3, amp: 0.38, pan: 0.2
  end
end

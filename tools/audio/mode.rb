# The mode changes: a breath, then two notes stepping up out of it.
#
# The one cue in swirls that marks a decision rather than a family, so it is
# allowed to be a little longer and a little more present than the twelve —
# but it is still a rising fifth over a hollow swell, not a fanfare. You hear
# it every time the > is pressed, and the point is that it tells you the
# picture is about to change without startling you into looking away.
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
# The interval and the shape are exactly what they were; only the key moved,
# and the strike was softened from 4 ms to 30 so it belongs beside twelve
# cues that have no transient in them at all.
with_fx :reverb, room: 0.8, mix: 0.42 do
  with_fx :lpf, cutoff: 94 do
    use_synth :hollow
    play :gs3, attack: 0.2, sustain: 0.15, release: 1.1, amp: 0.51
    use_synth :pretty_bell
    play :gs4, attack: 0.03, release: 0.8, amp: 0.36, pan: -0.2
    sleep 0.22
    play :ds5, attack: 0.03, release: 1.2, amp: 0.42, pan: 0.2
  end
end

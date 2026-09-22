# Petal Fall — a gust of pale-rose petals that ride the throw, then sway,
# tumble and sift downward, glinting as they turn.
#
# TIMBRE: glass, struck softly. :pretty_bell with a 90 ms attack is a bell
# with the strike taken off it — the glint without the click, which is the
# whole gentleness rule in one parameter.
# MOTION: a descent, three glints falling F5 -> Eb5 -> C5, each quieter than
# the one above it and each landing somewhere else across the stereo field.
# Its mirror is opal-rise, which is the same three notes climbing; cast into
# one, then the other, and the pair is the clearest test of whether motion
# alone can tell two families apart.
with_fx :reverb, room: 0.68, mix: 0.36 do
  with_fx :lpf, cutoff: 98 do
    use_synth :pretty_bell
    [[:f5, 0.37, -0.35], [:ds5, 0.29, 0.3], [:c5, 0.24, -0.15]].each do |n, a, p|
      play n, attack: 0.09, sustain: 0.03, release: 0.5, amp: a, pan: p
      sleep 0.19
    end
  end
end

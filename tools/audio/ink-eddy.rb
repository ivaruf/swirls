# Ink Eddy — the screen is a still dark pond of invisible water, and a gesture
# injects glowing ink and momentum into it. Nothing is bright here; the pond
# just slowly forgets.
#
# TIMBRE: the darkest cue in the set by a long way — a cutoff of 72 puts the
# ceiling near 1.3 kHz, so there is nothing up top at all. :dark_ambience does
# most of it, an octave below where any other cue sits. If the twelve are ever
# hard to tell apart, this is the one that never will be, because it is the
# only one that is mostly felt rather than heard.
# MOTION: a turn. The hollow voice slides Eb3 -> Ab3, which is the eddy rolling
# over once, and then it is gone.
with_fx :reverb, room: 0.8, mix: 0.42 do
  with_fx :lpf, cutoff: 72 do
    use_synth :dark_ambience
    play :gs2, attack: 0.3, sustain: 0.2, release: 0.8, amp: 1.46
    use_synth :hollow
    n = play :ds3, attack: 0.25, sustain: 0.15, release: 0.7, amp: 0.90, note_slide: 0.6
    control n, note: :gs3
  end
end

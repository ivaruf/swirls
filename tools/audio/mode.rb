# The mode changes: a breath, then two notes stepping up out of it.
#
# The one cue in swirls that marks a decision rather than a gesture, so it is
# allowed to be a little longer and a little more present than the cast — but
# it is still a rising fifth on a bell over a hollow swell, not a fanfare. You
# will hear it every time the > is pressed, and the point is that it tells you
# the picture is about to change without ever startling you into looking away.
#
# E4 under E5 -> B5: the tonic of the bed, so a mode change never lands in a
# key of its own.
with_fx :reverb, room: 0.88, mix: 0.5 do
  with_fx :lpf, cutoff: 110 do
    use_synth :hollow
    play :e4, attack: 0.25, sustain: 0.2, release: 1.6, amp: 0.5
    use_synth :pretty_bell
    play :e5, attack: 0.004, release: 0.9, amp: 0.35, pan: -0.2
    sleep 0.22
    play :b5, attack: 0.004, release: 1.4, amp: 0.42, pan: 0.2
  end
end

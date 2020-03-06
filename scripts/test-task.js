const log = (n) => {
  console.log(`hello ${n}\n\nhello ${n}\n\nhello ${n}\n\n`)
}

let count = 0

log(count++)
setTimeout(() => {
  log(count++)
  setTimeout(() => {
    log(count++)
    setTimeout(() => {
      log(count++)
      setTimeout(() => {
        log(count++)
        setTimeout(() => {
          log(count++)
          setTimeout(() => {
            log(count++)
            setTimeout(() => {
              log(count++)
              setTimeout(() => {
                log(count++)
                setTimeout(() => {
                  log(count++)
                  setTimeout(() => {
                    log(count++)
                    setTimeout(() => {
                      log(count++)
                      setTimeout(() => {
                        log(count++)
                        setTimeout(() => {
                          log(count++)
                          setTimeout(() => {
                            log(count++)
                            setTimeout(() => {
                              log(count++)
                              setTimeout(() => {
                                log(count++)
                                setTimeout(() => {
                                  log(count++)
                                }, 2000)
                              }, 2000)
                            }, 2000)
                          }, 2000)
                        }, 2000)
                      }, 2000)
                    }, 2000)
                  }, 2000)
                }, 2000)
              }, 2000)
            }, 2000)
          }, 2000)
        }, 2000)
      }, 3000)
    }, 2000)
  }, 3000)
}, 2000)

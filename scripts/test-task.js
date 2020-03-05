console.log('hello')
setTimeout(() => {
  console.log('hello')

  setTimeout(() => {
    console.log('hello')
  }, 5000)
}, 5000)

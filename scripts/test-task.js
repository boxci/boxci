console.log('hello 1\n\nhello 1\nhello 1\n\nhello 1')
setTimeout(() => {
  console.log('hello 2\n\nhello 2\nhello 2\n\nhello 2')

  setTimeout(() => {
    console.log('hello 3\n\nhello 3\nhello 3\n\nhello 3')
  }, 5000)
}, 5000)

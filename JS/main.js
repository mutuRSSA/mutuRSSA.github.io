const tabItems = document.querySelectorAll('.nav');
const tabContentItems = document.querySelectorAll('.tab-content-item');

//Select tab content item
function selectItem(e) {
    removeShow();
    //Grab content item from DOM
    const tabContentItems = document.querySelector(`#${this.id}-content`);
    //add show class
    tabContentItems.classList.add('show');
}

function removeShow() {
    tabContentItems.forEach(item => item.classList.remove('show'));
}

//listen for tab click
tabItems.forEach(item => item.addEventListener('click',selectItem));